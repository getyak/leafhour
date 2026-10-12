import { createSupabaseRest } from '../deploy/supabase-rest.mjs';

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  res.end(JSON.stringify(body));
};
const mergeBy = (left = [], right = [], key = 'id') => {
  const rows = new Map(left.map((row) => [row[key], row]));
  for (const row of right) if (!rows.has(row[key])) rows.set(row[key], row);
  return [...rows.values()];
};
const emptyRecords = (book) => ({ kind: 'marginalia-personal-records', schemaVersion: 2, bookId: book.bookId, contentVersion: book.contentVersion, comments: [], questions: [], readingSessions: [], position: null });
const emptyExperiences = (book) => ({ kind: 'marginalia-reading-experiences', schemaVersion: 1, bookId: book.bookId, contentVersion: book.contentVersion, states: {}, echoes: [], events: [] });

export function routeOf(req) {
  const value = req.query?.path;
  if (Array.isArray(value)) return '/api/' + value.join('/');
  if (value) return '/api/' + value;
  const pathname = new URL(req.url || '/', 'https://reader.invalid').pathname;
  return pathname.startsWith('/api/') ? pathname : '/api/' + pathname.replace(/^\/+/, '');
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : null;
}

export default async function handler(req, res) {
  try {
    const db = createSupabaseRest();
    const ownerId = process.env.READER_OWNER_ID || 'owner';
    const bookId = process.env.READER_BOOK_ID || 'finite-infinite-games-1986';
    const bookRow = await db.one('reader_books', `book_id=eq.${encodeURIComponent(bookId)}&select=payload,experience_pack,experience_metrics`);
    const book = bookRow.payload;
    let state;
    try {
      state = await db.one('reader_states', `owner_id=eq.${encodeURIComponent(ownerId)}&book_id=eq.${encodeURIComponent(bookId)}&select=records,experiences`);
    } catch (error) {
      if (error.status !== 503) throw error;
      state = { records: emptyRecords(book), experiences: emptyExperiences(book) };
      await db.upsert('reader_states', { owner_id: ownerId, book_id: bookId, ...state, updated_at: new Date().toISOString() }, 'owner_id,book_id');
    }

    const path = routeOf(req);
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (path === '/api/book') return json(res, 200, book);
      if (path === '/api/records' || path === '/api/records/export') return json(res, 200, state.records);
      if (path === '/api/experiences') return json(res, 200, { ...bookRow.experience_pack, states: state.experiences.states, echoes: state.experiences.echoes, echoAvailable: false });
      if (path === '/api/experiences/export') return json(res, 200, state.experiences);
      if (path === '/api/experience-metrics') return json(res, 200, bookRow.experience_metrics);
      if (path.startsWith('/api/echo/')) return json(res, 503, { error: '远程阅读版尚未连接实时回声服务' });
      return json(res, 404, { error: '找不到这个操作' });
    }
    if (req.method !== 'POST') return json(res, 405, { error: '不支持这个操作' });
    const input = await readBody(req);
    const save = async () => db.upsert('reader_states', { owner_id: ownerId, book_id: bookId, records: state.records, experiences: state.experiences, updated_at: new Date().toISOString() }, 'owner_id,book_id');

    if (path === '/api/progress') {
      state.records.position = input;
      await save();
      return json(res, 200, input);
    }
    if (path === '/api/comments' || path === '/api/questions') {
      if (!input?.id || !input?.passageId || !input?.text?.trim()) return json(res, 400, { error: '记录内容不完整' });
      const key = path.endsWith('questions') ? 'questions' : 'comments';
      const record = { ...input, bookId: book.bookId, contentVersion: book.contentVersion, origin: 'user', createdAt: input.createdAt || new Date().toISOString(), ...(key === 'questions' ? { status: 'open' } : {}) };
      const old = state.records[key].find((row) => row.id === record.id);
      if (!old) state.records[key].push(record);
      await save();
      return json(res, old ? 200 : 201, old || record);
    }
    if (path === '/api/records/import') {
      if (input?.kind !== 'marginalia-personal-records' || input.bookId !== book.bookId) return json(res, 400, { error: '请选择这本书的个人记录包' });
      state.records.comments = mergeBy(state.records.comments, input.comments);
      state.records.questions = mergeBy(state.records.questions, input.questions);
      state.records.readingSessions = mergeBy(state.records.readingSessions, input.readingSessions);
      if (input.position) state.records.position = input.position;
      await save();
      return json(res, 200, { comments: state.records.comments.length, questions: state.records.questions.length });
    }
    if (path === '/api/experience-state') {
      const card = bookRow.experience_pack?.cards?.find((row) => row.id === input?.cardId && row.chapterId === input.chapterId);
      if (!card) return json(res, 400, { error: '站队卡片不属于这一章' });
      const chapter = state.experiences.states[input.chapterId] || { shown: false, skipped: false, choice: null };
      if (input.action === 'shown') chapter.shown = true;
      if (input.action === 'skip') Object.assign(chapter, { shown: true, skipped: true });
      if (input.action === 'choose') Object.assign(chapter, { shown: true, choice: input.choiceId });
      state.experiences.states[input.chapterId] = chapter;
      await save();
      return json(res, 200, { chapterId: input.chapterId, state: chapter });
    }
    if (path === '/api/experience-events') {
      state.experiences.events = mergeBy(state.experiences.events, input?.events);
      await save();
      return json(res, 200, { accepted: input?.events?.length || 0, total: state.experiences.events.length });
    }
    if (path === '/api/experiences/import') {
      if (input?.kind !== 'marginalia-reading-experiences' || input.bookId !== book.bookId) return json(res, 400, { error: '请选择这本书的阅读体验记录包' });
      state.experiences.states = { ...input.states, ...state.experiences.states };
      state.experiences.echoes = mergeBy(state.experiences.echoes, input.echoes, 'runId');
      state.experiences.events = mergeBy(state.experiences.events, input.events);
      await save();
      return json(res, 200, { states: Object.keys(state.experiences.states).length, echoes: state.experiences.echoes.length, events: state.experiences.events.length });
    }
    if (path === '/api/echo' || path === '/api/explain' || /\/api\/echo\/[^/]+\/cancel$/.test(path)) return json(res, 503, { error: '远程阅读版尚未连接实时回声服务' });
    return json(res, 404, { error: '找不到这个操作' });
  } catch (error) {
    console.error(error);
    return json(res, error.status || 500, { error: error.status ? error.message : '服务暂时无法完成操作' });
  }
}
