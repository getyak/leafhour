import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createSupabaseRest } from '../deploy/supabase-rest.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const source = process.env.READER_CONTENT_DIR || path.join(root, 'local', 'finite-infinite-games');
const read = (name) => readFile(path.join(source, name), 'utf8').then(JSON.parse);
const [payload, experiencePack, experienceMetrics] = await Promise.all([
  read('book.json'),
  read('experience-pack.json'),
  read('experience-metrics.json'),
]);

const db = createSupabaseRest();
await db.upsert('reader_books', {
  book_id: payload.bookId,
  content_version: payload.contentVersion,
  payload,
  experience_pack: experiencePack,
  experience_metrics: experienceMetrics,
  updated_at: new Date().toISOString(),
}, 'book_id');

console.log(`Imported ${payload.chapters.length} chapters and ${payload.sections.length} sections for ${payload.bookId}.`);
