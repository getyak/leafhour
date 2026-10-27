const icons = {
  library:
    '<path d="M4 4v16M9 4v16M14 4l6 15M3 4h3M8 4h3M3 20h8M14 4l3-1 6 16-3 1"/>',
  down: '<path d="m5 9 7 7 7-7"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  up: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  conversation:
    '<path d="M20 11a8 8 0 0 1-8 8H5l-4 3 1.6-6A8 8 0 1 1 20 11Z"/><path d="M6 10h8M6 14h5"/>',
  quote: '<path d="M10 5H4v7h5c0 4-2 6-5 7M21 5h-6v7h5c0 4-2 6-5 7"/>',
  note: '<path d="M14 4H4v16h16V10m-9 3 8-8 3 3-8 8-4 1Z"/>',
  check: '<path d="m5 12 5 5L20 6"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 4H4v16h16v-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z"/>',
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.right}</svg>`;
function drawIcons(scope = document) {
  scope
    .querySelectorAll("[data-icon]")
    .forEach((node) => (node.innerHTML = icon(node.dataset.icon)));
}
import { advanceSpring, resistedPosition, nearestDetent } from "./motion.mjs";
import { placeSelectionMenu } from "./selection-position.mjs";
import { normalizeReadingPosition, captureReadingPosition, restoreReadingPosition } from "./reading-position.mjs";
import { quoteIdentity, resolveCompanionContext } from "./companion-context.mjs";
import { readNoteDrafts, undoNoteSave } from "./note-recovery.mjs";
import { initialIntent, transitionIntent, startHold, moveHold, holdReady, HOLD_MS } from "./reading-intent.mjs";
import { positionAtProgress, progressAtPosition } from "./reading-progress.mjs";

const paragraphs = [
  {
    id: "walden-2-001",
    source:
      "I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived.",
    literal:
      "我走进树林，因为我希望有意识地生活，直面生活中最基本的事实，看看能否学到它要教我的东西；免得临终时才发现，自己从未活过。",
    interpretive:
      "我来到林中，是想清醒地过日子，面对生活最要紧的事实，看看生活能教给我什么；我不想等到死时才发现，自己没有真正生活过。",
  },
  {
    id: "walden-2-002",
    source:
      "I did not wish to live what was not life, living is so dear; nor did I wish to practise resignation, unless it was quite necessary.",
    literal:
      "我不愿过不算生活的生活，生活是如此珍贵；我也不愿练习顺从，除非确实有必要。",
    interpretive:
      "日子这样珍贵，我不愿把它过成并非生活的样子；只要还没有到非如此不可的时候，我也不想认命。",
  },
  {
    id: "walden-2-003",
    source:
      "I wanted to live deep and suck out all the marrow of life, to live so sturdily and Spartan-like as to put to rout all that was not life",
    literal:
      "我想活得深入，吸取生活所有的骨髓，活得坚实而像斯巴达人那样，使一切不是生活的东西败退。",
    interpretive:
      "我想把生活过深，尝尽它的滋味；用结实、简朴的日子，赶走那些算不上生活的东西。",
  },
  {
    id: "walden-2-004",
    source: "Our life is frittered away by detail.",
    literal: "我们的生活被细节耗散了。",
    interpretive: "日子就在种种琐事里一点点消磨。",
  },
];
const sourceURL = "https://www.gutenberg.org/files/205/205-h/205-h.htm";
const readingDocument = { bookId: "walden-public-sample", sourceVersion: "prototype-20261026" };
const $ = (id) => document.getElementById(id),
  escape = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const key = "leafhour-ios-half-sheet-prototype-v1";
let saved = {};
try {
  saved = JSON.parse(sessionStorage.getItem(key) || "{}");
} catch {}
if (!saved || typeof saved !== "object" || Array.isArray(saved)) saved = {};
const initialLayer = ["source", "literal", "interpretive"].includes(saved.layer) ? saved.layer : "interpretive";
const savedParagraph = paragraphs.find(p => p.id === saved.readingPosition?.passageId);
const initialReading = savedParagraph && normalizeReadingPosition(saved.readingPosition, { ...readingDocument, layer: initialLayer }, savedParagraph[initialLayer]);
const initialQuote = () => ({
  passageId: paragraphs[0].id,
  text: paragraphs[0].interpretive,
  layer: "interpretive",
  version: "prototype-20261026",
  selection: "固定样文选区",
  startUtf16: 0,
  endUtf16: paragraphs[0].interpretive.length,
  startCodePoint: 0,
});
let keyboardTools = false;
const state = {
  theme: saved.theme === "night" ? "night" : "paper",
  size: Number.isFinite(Number(saved.size)) && saved.size != null ? Math.max(18, Math.min(28, Number(saved.size))) : 22,
  layer: initialLayer,
  readingTop: Number.isFinite(Number(saved.readingTop)) ? Math.max(0, Number(saved.readingTop)) : 0,
  readingPosition: initialReading?.position || null,
  resumePassageId: initialReading?.position.passageId || paragraphs[0].id,
  restoringReading: false,
  readingTransition: false,
  readingRestoreRevision: 0,
  readingWidth: 0,
  readingHeight: 0,
  quote: saved.quote || initialQuote(),
  draft: saved.draft || "",
  drafts: saved.drafts || [],
  notes: saved.notes || [],
  turns: saved.turns || [],
  pendingTurn: saved.pendingTurn || null,
  noteDrafts: saved.noteDrafts || {},
  question: saved.question || "",
  answered: !!saved.answered,
  discussionStarted: saved.discussionStarted === true,
  previewQuote: null,
  noteSaveUndo: null,
  readingIntent: initialIntent(),
  touchHold: null,
  touchSelectionArmed: false,
  lastPointerType: matchMedia("(pointer: coarse)").matches ? "touch" : "mouse",
  selectionReturnFrame: null,
  progressAdjusting: false,
  progressScrollUntil: 0,
  route: "closed",
  detent: "half",
  returnFrame: null,
  offline: false,
  pendingSelection: null,
  selectionRange: null,
  recordsTab: "notes",
  y: 0,
  velocity: 0,
  target: 0,
  raf: 0,
  drag: null,
  closingFrame: null,
};
window.leafhourPrototype = {
  snapshot: () => ({
    route: state.route,
    detent: state.detent,
    readingTop: $("reading-scroll").scrollTop,
    readingPosition: state.readingPosition ? { ...state.readingPosition } : null,
    quote: { ...state.quote },
    draft: state.draft,
    drafts: state.drafts.map((x) => ({ ...x })),
    question: state.question,
    discussionStarted: state.discussionStarted,
    notes: state.notes.length,
    theme: state.theme,
    layer: state.layer,
    offline: state.offline,
    intent: state.readingIntent.kind,
    selection: state.pendingSelection ? { ...state.pendingSelection } : null,
  }),
  scenario: showScenario,
};
function syncReadingIntent() {
  const kind = state.readingIntent.kind, active = document.activeElement;
  if ((kind !== "top" && $("reader-nav").contains(active)) || (kind !== "progress" && $("reading-dock").contains(active))) $("reading-scroll").focus({ preventScroll: true });
  $("phone").dataset.intent = kind;
  $("reader-nav").inert = kind !== "top";
  $("reading-dock").inert = kind !== "progress";
  for (const id of ["wake-top", "wake-bottom"]) {
    $(id).inert = !["pure", "top", "progress"].includes(kind);
    $(id).setAttribute("aria-hidden", String($(id).inert));
  }
  $("wake-top").setAttribute("aria-expanded", String(kind === "top"));
  $("wake-bottom").setAttribute("aria-expanded", String(kind === "progress"));
}
function setReadingIntent(type) {
  state.readingIntent = transitionIntent(state.readingIntent, { type }, performance.now());
  syncReadingIntent();
  clearTimeout(setReadingIntent.timer);
  if (state.readingIntent.expiresAt !== null && !state.readingIntent.pinned) setReadingIntent.timer = setTimeout(() => setReadingIntent("tick"), Math.max(0, state.readingIntent.expiresAt - performance.now()));
}
function wakeReadingTools(kind) {
  if (state.route !== "closed") return;
  hideSelectionMenu();
  window.getSelection()?.removeAllRanges();
  setReadingIntent(kind);
  const active = document.activeElement;
  if (keyboardTools && (active === $("wake-top") || active === $("wake-bottom"))) setReadingIntent("pin");
}
function updateProgress() {
  const index = paragraphs.findIndex(p => p.id === state.readingPosition?.passageId);
  $("dock-location").textContent = ["林中生活", "生活如此珍贵", "活得深入", "琐事与日子"][Math.max(0, index)];
  const fraction = progressAtPosition(state.readingPosition, paragraphs, state.layer);
  if (!state.progressAdjusting) $("reading-progress").value = String(Math.round(fraction * 1000));
  $("progress-value").textContent = Math.round(fraction * 100) + "%";
  $("reading-progress").setAttribute("aria-valuetext", Math.round(fraction * 100) + "%");
}
function persist() {
  const scroller = $("reading-scroll");
  if (!state.restoringReading && !state.readingTransition && readingGeometryMatches() && scroller.scrollTop !== state.readingTop)
    state.readingPosition = captureReadingPosition(scroller, readerIdentity()) || state.readingPosition;
  state.readingTop = scroller.scrollTop;
  updateContextChrome();
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        theme: state.theme,
        size: state.size,
        layer: state.layer,
        readingTop: $("reading-scroll").scrollTop,
        readingPosition: state.readingPosition,
        quote: state.quote,
        draft: state.draft,
        drafts: state.drafts,
        notes: state.notes,
        question: state.question,
        answered: state.answered,
        discussionStarted: state.discussionStarted,
        turns: state.turns,
        pendingTurn: state.pendingTurn,
        noteDrafts: state.noteDrafts,
      }),
    );
  } catch {}
}
function scheduleNoticeEnd() {
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => {
    const toast = $("phone-toast");
    if (toast.contains(document.activeElement)) return;
    toast.hidden = true;
    state.noteSaveUndo = null;
  }, notify.undo ? 8000 : 2800);
}
function notify(text, { undo = false } = {}) {
  notify.undo = undo;
  if (!undo) state.noteSaveUndo = null;
  const toast = $("phone-toast"), label = document.createElement("span");
  label.textContent = text;
  toast.replaceChildren(label);
  if (undo) {
    const button = document.createElement("button");
    button.dataset.action = "undo-note-save";
    button.textContent = "撤销";
    toast.append(button);
  }
  toast.hidden = false;
  scheduleNoticeEnd();
}
$("phone-toast").addEventListener("focusout", scheduleNoticeEnd);
$("phone-toast").addEventListener("pointerenter", () => clearTimeout(notify.timer));
$("phone-toast").addEventListener("pointerleave", scheduleNoticeEnd);
function setStudy(title, detail) {
  $("study-state").textContent = title;
  $("study-detail").textContent = detail;
  document
    .querySelectorAll("[data-scenario]")
    .forEach((button) =>
      button.classList.toggle(
        "active",
        button.dataset.scenario === state.route ||
          (button.dataset.scenario === "resume" && state.route === "closed"),
      ),
    );
}
function readerAnchor() {
  return state.readingPosition || captureReadingPosition($("reading-scroll"), readerIdentity());
}
function readerIdentity() {
  return { ...readingDocument, layer: $("prose").dataset.layer || state.layer };
}
function readingGeometryMatches() {
  return state.readingWidth === $("phone").clientWidth && state.readingHeight === $("phone").clientHeight;
}
function rememberReadingGeometry() {
  state.readingWidth = $("phone").clientWidth;
  state.readingHeight = $("phone").clientHeight;
}
function restoreReaderAnchor(anchor) {
  if (!anchor) return false;
  state.restoringReading = true;
  $("reading-scroll").setAttribute("data-restoring", "");
  const revision = ++state.readingRestoreRevision;
  const restored = restoreReadingPosition($("reading-scroll"), anchor, readerIdentity());
  if (restored) state.readingPosition = restored;
  state.readingTop = $("reading-scroll").scrollTop;
  rememberReadingGeometry();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (revision !== state.readingRestoreRevision) return;
    state.restoringReading = false;
    $("reading-scroll").removeAttribute("data-restoring");
  }));
  return !!restored;
}
function renderReader({ restore = true } = {}) {
  const anchor = readerAnchor();
  hideSelectionMenu();
  $("phone").dataset.theme = state.theme;
  $("phone").style.setProperty("--reader-size", state.size + "px");
  $("version-label").textContent =
    state.layer === "source"
      ? "作者原文 · 节选"
      : state.layer === "literal"
        ? "示例直译"
        : "示例意译";
  $("nav-version").textContent = $("version-label").textContent;
  $("prose").dataset.layer = state.layer;
  $("prose").innerHTML = paragraphs
    .map(
      (p, i) =>
        `<p class="passage ${state.layer === "source" ? "source" : ""}" id="${p.id}" data-passage="${p.id}">${p.id === state.resumePassageId ? '<span class="resume-mark">上次读到这里</span>' : ""}<span class="passage-text">${escape(p[state.layer])}</span></p>`,
    )
    .join("");
  if (restore) restoreReaderAnchor(anchor);
  else rememberReadingGeometry();
}
function quoteKey(quote) {
  return quoteIdentity(quote);
}
function currentReadingQuote() {
  const id = state.readingPosition?.passageId || paragraphs[0].id;
  const quote = captureQuote(paragraphs.some(p => p.id === id) ? id : paragraphs[0].id);
  return { ...quote, selection: "当前阅读段落" };
}
function companionContext() {
  return resolveCompanionContext({ readingQuote: currentReadingQuote(), discussionQuote: state.quote, discussionStarted: state.discussionStarted, draft: state.draft, question: state.question, pendingTurn: state.pendingTurn });
}
function layerLabel(layer) {
  return { source: "原文", literal: "示例直译", interpretive: "示例意译" }[layer] || "来源待确认";
}
function contextCaption(context) {
  return { current: "正在读的段落", selection: "当前段的选文", previous: "先前讨论的原句" }[context.relation] + " · " + layerLabel(state.quote.layer);
}
function updateContextChrome() {
  const context = companionContext();
  $("companion-label").textContent = context.label;
  const label = $("sheet-body").querySelector("[data-context-label]");
  if (label) label.textContent = contextCaption(context);
  const switcher = $("sheet-body").querySelector('[data-action="ask-current"]');
  if (switcher) switcher.hidden = !context.canAskCurrent;
  if (state.route === "companion") $("sheet-title").textContent = context.relation === "previous" ? "继续讨论" : "读到这里";
}
function viewQuote() {
  return state.previewQuote || state.quote;
}
function noteDraftEntries() {
  return readNoteDrafts(state.noteDrafts, { passages: paragraphs, version: readingDocument.sourceVersion });
}
function openNotePreview(quote, { capture = true } = {}) {
  if (capture) captureComposer();
  if (["companion", "discussion", "records"].includes(state.route)) state.returnFrame = { route: state.route, detent: state.detent, scrollTop: $("sheet-body").scrollTop, draft: state.draft, quote: { ...state.quote }, question: state.question, answered: state.answered };
  else if (!["note", "original"].includes(state.route)) state.returnFrame = null;
  state.previewQuote = { ...quote };
  openRoute("note", "full", { capture: false });
}
function preserveCurrentQuestion() {
  if (!state.question.trim()) return;
  const key = quoteKey(state.quote);
  if (state.pendingTurn?.question === state.question && quoteKey(state.pendingTurn.quote) === key) return;
  if (state.turns.some(t => t.question === state.question && quoteKey(t.quote) === key)) return;
  rememberTurn({ id: "prototype-retained-" + Date.now() + "-" + state.turns.length, question: state.question, quote: { ...state.quote }, answered: state.answered });
}
function enterCompanion() {
  captureComposer();
  const context = companionContext();
  if (!context.quote) return notify("原问题的出处不完整，请先重新选一句");
  if (context.mode === "reading") takeQuote(context.quote, { open: false });
  else if (quoteKey(context.quote) !== quoteKey(state.quote)) {
    state.quote = { ...context.quote };
    if (!state.question.trim() && state.pendingTurn) state.question = state.pendingTurn.question;
  }
  state.discussionStarted = true;
  persist();
  openRoute("companion", "half", { capture: false, exposeQuote: context.mode === "reading" ? context.quote : null });
}
function captureQuote(id, text, startOffset = null) {
  const p = paragraphs.find((p) => p.id === id) || paragraphs[0],
    value = text || p[state.layer],
    start =
      startOffset !== null ? startOffset : value === p[state.layer] ? 0 : -1;
  return {
    passageId: p.id,
    text: value,
    layer: state.layer,
    version: "prototype-20261026",
    selection: "当前样文选区",
    startUtf16: start < 0 ? null : start,
    endUtf16: start < 0 ? null : start + value.length,
    startCodePoint:
      start < 0 ? null : [...p[state.layer].slice(0, start)].length,
  };
}
function rememberTurn(turn) {
  const snapshot = { ...turn, quote: { ...turn.quote } };
  const index = state.turns.findIndex((item) => item.id === turn.id);
  if (index < 0) state.turns.push(snapshot);
  else state.turns[index] = snapshot;
  const completed = state.turns.filter((item) => item.answered !== false).slice(-6);
  state.turns = state.turns.filter((item) => item.answered === false || completed.includes(item));
}
function rememberPendingTurn(exceptId = null) {
  if (state.pendingTurn && state.pendingTurn.id !== exceptId)
    rememberTurn({ ...state.pendingTurn, answered: false });
}
function takeQuote(next, { open = true } = {}) {
  captureComposer();
  state.previewQuote = null;
  if (quoteKey(state.quote) !== quoteKey(next)) {
    preserveCurrentQuestion();
    if (state.draft.trim()) {
      state.drafts.push({ quote: { ...state.quote }, draft: state.draft });
      notify("上一句的问题草稿已保留");
    }
    const previous = state.drafts.findIndex(
      (item) => quoteKey(item.quote) === quoteKey(next),
    );
    state.draft =
      previous >= 0 ? state.drafts.splice(previous, 1)[0].draft : "";
    state.question = "";
    state.answered = false;
    state.discussionStarted = false;
    state.returnFrame = null;
  }
  state.quote = next;
  $("question-input").value = state.draft;
  hideSelectionMenu();
  window.getSelection()?.removeAllRanges();
  persist();
  if (open) openRoute("companion", "half", { capture: false });
}
function selectPassage(id) {
  const text = $(id)?.querySelector(".passage-text");
  if (!text) return;
  const range = document.createRange();
  range.selectNodeContents(text);
  state.touchSelectionArmed = true;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  presentSelection(range);
}
function suspendForSelection() {
  if (state.route === "closed") return;
  captureComposer();
  const frame = ["companion", "discussion", "records"].includes(state.route)
    ? { route: state.route, detent: state.detent, scrollTop: $("sheet-body").scrollTop, draft: state.draft, quote: { ...state.quote }, question: state.question, answered: state.answered }
    : state.returnFrame;
  closeSheet({ immediate: true, focus: false });
  state.selectionReturnFrame = frame;
}
function presentSelection(range) {
  const parent = node => node.nodeType === 3 ? node.parentElement : node;
  const first = parent(range.startContainer)?.closest(".passage-text"), last = parent(range.endContainer)?.closest(".passage-text");
  if (!first || first !== last || !range.toString().trim()) return hideSelectionMenu();
  suspendForSelection();
  const prefix = document.createRange();
  prefix.selectNodeContents(first);
  prefix.setEnd(range.startContainer, range.startOffset);
  hideSelectionMenu({ release: false });
  const id = first.closest("[data-passage]").dataset.passage;
  state.pendingSelection = captureQuote(id, range.toString(), prefix.toString().length);
  state.selectionRange = range.cloneRange();
  state.touchSelectionArmed = true;
  if (range.toString() === first.textContent) $(id).classList.add("is-selected");
  setReadingIntent("selection");
  $("selection-menu").hidden = false;
  positionSelectionMenu();
  setStudy("选区才唤醒动作", "只选字不会替换已有问题；点解释才采用这份原句，旧草稿仍保留。");
}
function hideSelectionMenu({ release = true } = {}) {
  $("selection-menu").hidden = true;
  state.pendingSelection = null;
  state.selectionRange = null;
  document.querySelectorAll(".passage.is-selected").forEach(n => n.classList.remove("is-selected"));
  if (release) {
    state.touchSelectionArmed = false;
    state.selectionReturnFrame = null;
    if (state.readingIntent.kind === "selection") setReadingIntent("pure");
  }
}
function positionSelectionMenu() {
  const menu = $("selection-menu");
  if (menu.hidden || !state.pendingSelection) return;
  const text = $(state.pendingSelection.passageId)?.querySelector(".passage-text");
  if (!text) return hideSelectionMenu();
  const phone = $("phone").getBoundingClientRect();
  const scale = phone.width / $("phone").clientWidth;
  const local = rect => ({ left: (rect.left - phone.left) / scale, right: (rect.right - phone.left) / scale, top: (rect.top - phone.top) / scale, bottom: (rect.bottom - phone.top) / scale });
  const selected = state.selectionRange?.commonAncestorContainer.isConnected
    ? state.selectionRange.getBoundingClientRect() : text.getBoundingClientRect();
  const anchor = local(selected);
  const reading = local($("reading-scroll").getBoundingClientRect());
  const nav = local($("reader-nav").getBoundingClientRect());
  const dock = local($("reading-dock").getBoundingClientRect());
  const bounds = { left: 16, right: $("phone").clientWidth - 16, top: reading.top + 8, bottom: reading.bottom - 8 };
  if (state.readingIntent.kind === "top") bounds.top = Math.max(bounds.top, nav.bottom + 8);
  if (state.readingIntent.kind === "progress") bounds.bottom = Math.min(bounds.bottom, dock.top - 8);
  if (state.route !== "closed") bounds.bottom = Math.min(bounds.bottom, local($("reader-sheet").getBoundingClientRect()).top - 8);
  const size = { width: menu.offsetWidth, height: menu.offsetHeight };
  if (anchor.bottom < bounds.top || anchor.top > bounds.bottom || bounds.bottom - bounds.top < size.height) return hideSelectionMenu();
  const placement = placeSelectionMenu({ ...anchor, top: Math.max(anchor.top, bounds.top), bottom: Math.min(anchor.bottom, bounds.bottom) }, size, bounds);
  menu.style.left = placement.left + "px";
  menu.style.top = placement.top + "px";
  menu.style.setProperty("--anchor-x", Math.max(16, Math.min(size.width - 16, (anchor.left + anchor.right) / 2 - placement.left)) + "px");
  menu.dataset.placement = placement.placement;
}
function contextQuote(kind = "discussion") {
  const quote = kind === "note" ? viewQuote() : state.quote;
  const context = companionContext();
  const caption = kind === "note" ? "笔记原句 · " + layerLabel(quote.layer) : contextCaption(context);
  if (kind === "discussion") return `<div class="context-quote" data-quote-kind="discussion" data-passage-id="${escape(quote.passageId)}" data-source-layer="${escape(quote.layer)}" data-selection-start="${quote.startUtf16 ?? ""}" data-selection-end="${quote.endUtf16 ?? ""}"><small data-context-label>${escape(caption)}</small><div class="context-actions"><button class="quote-excerpt quote-return" data-action="return-quote" aria-label="返回提问原句" aria-description="${escape(quote.text)}"><span class="quote-line">${escape(quote.text)}</span>${icon("external")}</button><button class="ask-current" data-action="ask-current" ${context.canAskCurrent ? "" : "hidden"}>改问正在读的段落 ${icon("right")}</button></div></div>`;
  return `<div class="context-quote" data-passage-id="${escape(quote.passageId)}" data-source-layer="${escape(quote.layer)}" data-selection-start="${quote.startUtf16 ?? ""}" data-selection-end="${quote.endUtf16 ?? ""}"><small ${kind === "discussion" ? "data-context-label" : ""}>${escape(caption)}</small><div class="quote-excerpt">${escape(quote.text)}</div><div class="context-actions"><button data-action="return-quote">${kind === "note" ? "返回笔记原句" : "返回提问原句"}</button>${kind === "discussion" ? `<button class="ask-current" data-action="ask-current" ${context.canAskCurrent ? "" : "hidden"}>改问正在读的段落 ${icon("right")}</button>` : ""}</div></div>`;
}
function answerText() {
  return (
    {
      "walden-2-001":
        "这里的 deliberately，可以读成“有意识地选择怎样生活”。\n\n梭罗把林中生活当作一次亲自检验。他想知道，哪些事值得用自己的日子去做。",
      "walden-2-002":
        "这一段同时说到珍惜生活与不愿认命。\n\n“除非确实有必要”保留了余地，不能删去这个限定，读成任何时候都必须抗拒。",
      "walden-2-003":
        "“骨髓”把生活写成需要亲身尝试的东西。\n\n一种读法是：他期待从切身经验里分辨，哪些事对自己是必要的。",
      "walden-2-004":
        "这句把日子的消耗归于不断分散注意力的琐事。\n\n可以接着想：哪些细节值得认真做，哪些只是占满了时间？",
    }[state.quote.passageId] || "这份原型只提供所选公版样章的固定讲解示例。"
  );
}
function discussion() {
  const full = state.route === "discussion",
    question =
      state.question ||
      {
        "walden-2-001": "deliberately 为什么不只是“刻意”？",
        "walden-2-002": "这里为什么说“不算生活”？",
        "walden-2-003": "“活得深入”是什么意思？",
        "walden-2-004": "琐事怎样消磨了日子？",
      }[state.quote.passageId];
  return (
    contextQuote() +
    (full || state.answered
      ? `${state.question ? "" : '<p class="answer-label">问题示例</p>'}<p class="question-bubble">${escape(question)}</p>`
      : "") +
    (state.offline || state.pendingTurn
      ? `<div class="error-card"><p>${state.offline ? "暂时无法连接。问题和选文已保留，你可以继续读。" : state.pendingTurn && quoteKey(state.pendingTurn.quote) !== quoteKey(state.quote) ? "上一句还有一次未完成的提问，返回后可以重试。" : "连接已恢复，这次提问尚未重试。"}</p><button data-action="retry">${state.pendingTurn && quoteKey(state.pendingTurn.quote) !== quoteKey(state.quote) ? "返回并重试原问题" : "重试这次提问"}</button></div>`
      : `<p class="answer-label">讲解 · 示例</p><p class="answer">${escape(answerText())}</p><button class="source-link" data-action="citation">本段 ${icon("external")}</button><div class="answer-actions"><button data-action="expand">${icon("conversation")}接着聊</button><button data-action="note">${icon("note")}记一句</button></div><p class="scope-line">依据：所选句与本段前后文</p>`)
  );
}
function renderBody() {
  let html = "";
  let title = "读到这里";
  let composer = false;
  let back = false;
  if (state.route === "companion" || state.route === "discussion") {
    title = state.route === "discussion" ? "接着聊这句" : "读到这里";
    html = discussion();
    composer = true;
  }
  if (state.route === "citation") {
    title = "核对出处";
    back = true;
    const p =
      paragraphs.find((p) => p.id === state.quote.passageId) || paragraphs[0];
    html = `<p class="quote-title">瓦尔登湖 · 第二章</p><span class="record-kind">作者原文 · 节选</span><p class="citation-original">${escape(p.source)}</p><div class="quiet-rule"></div><span class="record-kind">示例意译</span><p class="citation-translation">${escape(p.interpretive)}</p><a class="source-external" href="${sourceURL}" target="_blank" rel="noopener">查看公版底本 ${icon("external")}</a>`;
  }
  if (state.route === "original") {
    title = "核对原文";
    back = !!state.returnFrame;
    const p =
      paragraphs.find((p) => p.id === viewQuote().passageId) || paragraphs[0];
    html = `<div class="segmented"><button class="${state.layer === "source" ? "active" : ""}" data-layer="source">原文</button><button class="${state.layer === "literal" ? "active" : ""}" data-layer="literal">直译</button><button class="${state.layer === "interpretive" ? "active" : ""}" data-layer="interpretive">意译</button></div><span class="record-kind">作者原文 · 节选</span><p class="citation-original">${escape(p.source)}</p><div class="quiet-rule"></div><span class="record-kind">${state.layer === "literal" ? "示例直译" : "示例意译"}</span><p class="citation-translation">${escape(p[state.layer === "literal" ? "literal" : "interpretive"])}</p>`;
  }
  if (state.route === "note") {
    title = "记一句";
    back = !!state.returnFrame;
    html =
      contextQuote("note") +
      `<textarea class="note-field" id="note-field" aria-label="自己的笔记" placeholder="用自己的话，留下一点想法…">${escape(state.noteDrafts[quoteKey(viewQuote())] || "")}</textarea><div class="save-note-row"><span>自己的笔记</span><button class="primary-button" data-action="save-note">保存</button></div>`;
  }
  if (state.route === "library") {
    title = "书房";
    html = `<div class="shelf-book"><div class="book-cover"><h3>瓦尔登湖</h3><p>Walden<br>Henry D. Thoreau</p><div class="cover-pond"></div></div><div><h3>瓦尔登湖</h3><p>亨利·戴维·梭罗<br>第二章 · 公版样章</p><button class="primary-button" data-action="continue">继续读</button></div></div><button class="list-row" data-action="records"><span><strong>我的记录</strong><small>笔记与还想继续的问题</small></span>${icon("right")}</button><button class="list-row" data-action="appearance"><span><strong>阅读偏好</strong><small>字号、纸面与正文版本</small></span>${icon("right")}</button><p class="shelf-note">这份原型只放一份公版样章，原文与两种示例译文独立保存。</p>`;
  }
  if (state.route === "records") {
    title = "我的记录";
    html = `<div class="segmented"><button data-record-tab="notes" class="${state.recordsTab === "notes" ? "active" : ""}">自己的笔记</button><button data-record-tab="discussion" class="${state.recordsTab === "discussion" ? "active" : ""}">讨论</button></div>`;
    if (state.recordsTab === "notes") {
      const drafts = noteDraftEntries();
      if (drafts.length) html += `<div class="record-section-heading">未保存的笔记 <span>${drafts.length}</span></div>` + drafts.map(d => `<button class="list-row note-draft-row" data-note-draft="${escape(d.key)}"><span><span class="record-kind">草稿 · ${escape(layerLabel(d.quote.layer))}</span><strong>${escape(d.text.trim())}</strong><small>原句 · ${escape(d.quote.text.slice(0, 32))}…</small></span>${icon("right")}</button>`).join("");
      if (state.notes.length && drafts.length) html += '<div class="record-section-heading saved-notes-heading">已保存</div>';
      html += state.notes.length
        ? state.notes
            .map(
              (n, i) =>
                `<button class="list-row" data-record="${i}"><span><span class="record-kind">自己的笔记</span><strong>${escape(n.text)}</strong><small>瓦尔登湖 · 第二章</small></span>${icon("right")}</button>`,
            )
            .join("")
        : drafts.length ? '' : '<div class="empty-records"><h3>还没有笔记</h3><p>读到想留下的话，可以记一句。</p><button class="secondary-button" data-action="continue">回到书里</button></div>';
    } else {
      html += state.turns.length
        ? state.turns
            .map(
              (turn, index) =>
                `<button class="list-row" data-turn="${index}"><span><span class="record-kind">${turn.answered === false ? "未完成提问" : "阅读讨论"} · 原型演示</span><strong>${escape(turn.question)}</strong><small>瓦尔登湖 · ${escape(turn.quote.text.slice(0, 24))}…</small></span>${icon("right")}</button>`,
            )
            .join("")
        : `<button class="list-row" data-action="expand"><span><span class="record-kind">阅读讨论 · 示例</span><strong>deliberately 为什么不只是“刻意”？</strong><small>瓦尔登湖 · 绑定提问原句</small></span>${icon("right")}</button>`;
    }
  }
  if (state.route === "contents") {
    title = "目录";
    html =
      '<p class="quote-title">第二章 · 我生活的地方，我为何生活</p>' +
      paragraphs
        .map(
          (p, i) =>
            `<button class="list-row" data-jump="${p.id}"><span><strong>${["林中生活", "生活如此珍贵", "活得深入", "琐事与日子"][i]}</strong><small>${escape(p.interpretive.slice(0, 25))}…</small></span>${icon("right")}</button>`,
        )
        .join("");
  }
  if (state.route === "appearance") {
    title = "排版";
    html = `<div class="setting-group"><label>正文大小</label><div class="type-size-controls"><button data-size="-1" aria-label="减小字号">A−</button><output>${state.size}</output><button data-size="1" aria-label="增大字号">A＋</button></div></div><div class="setting-group"><label>纸面</label><button class="appearance-option" data-theme="paper" aria-pressed="${state.theme === "paper"}">清纸 ${state.theme === "paper" ? icon("check") : icon("sun")}</button><button class="appearance-option night-preview" data-theme="night" aria-pressed="${state.theme === "night"}">夜读 ${state.theme === "night" ? icon("check") : icon("moon")}</button></div><div class="setting-group"><label>正文版本</label><div class="segmented"><button class="${state.layer === "source" ? "active" : ""}" data-layer="source">原文</button><button class="${state.layer === "literal" ? "active" : ""}" data-layer="literal">直译</button><button class="${state.layer === "interpretive" ? "active" : ""}" data-layer="interpretive">意译</button></div></div><p class="type-preview">我来到林中，是想清醒地过日子。</p>`;
  }
  $("sheet-title").textContent = title;
  $("sheet-back").hidden = !back;
  $("sheet-back").lastElementChild.textContent = state.returnFrame?.route === "records" ? "返回记录" : "返回讨论";
  $("sheet-title").hidden = back;
  $("sheet-done").textContent = [
    "companion",
    "discussion",
    "citation",
  ].includes(state.route)
    ? "继续读"
    : "完成";
  $("sheet-body").innerHTML = html;
  $("composer").hidden = !composer;
  $("question-input").value = state.draft;
  $("draft-return").hidden = !state.drafts.length;
  $("sheet-body").scrollTop = 0;
  drawIcons($("sheet-body"));
  updateContextChrome();
}
function phoneHeight() {
  return $("phone").clientHeight;
}
function targetY(detent) {
  return (
    phoneHeight() * (detent === "closed" ? 0.88 : detent === "half" ? 0.36 : 0)
  );
}
function paintSheet() {
  const visible = Math.max(0, phoneHeight() * 0.88 - state.y);
  $("reader-sheet").style.transform = `translateY(${state.y}px)`;
  $("reader-sheet").style.paddingBottom = Math.max(0, state.y) + 31 + "px";
  const fullness = Math.max(0, Math.min(1, (visible / phoneHeight() - 0.52) / 0.36));
  const isFull = state.route !== "closed" && state.detent === "full";
  const becameModal = isFull && $("reader-sheet").getAttribute("aria-modal") !== "true";
  $("sheet-scrim").hidden = fullness <= 0.002;
  $("sheet-scrim").style.opacity = fullness;
  $("sheet-scrim").style.pointerEvents = isFull ? "auto" : "none";
  $("reader-sheet").setAttribute("aria-modal", String(isFull));
  $("reader-sheet").setAttribute("role", isFull ? "dialog" : "region");
  $("sheet-grip").setAttribute("aria-expanded", String(isFull));
  $("reading-scroll").inert = isFull;
  syncReadingIntent();
  if (becameModal && !$("reader-sheet").contains(document.activeElement))
    $("sheet-done").focus({ preventScroll: true });
  $("reading-scroll").style.paddingBottom =
    state.route === "closed" ? "24px" : Math.max(24, visible - 85) + "px";
  positionSelectionMenu();
}
function snap(detent, { immediate = false, onComplete = null } = {}) {
  state.readingTransition = true;
  $("reader-sheet").dataset.motion = "moving";
  state.detent = detent;
  state.target = targetY(detent);
  cancelAnimationFrame(state.raf);
  if (immediate || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    state.y = state.target;
    state.velocity = 0;
    paintSheet();
    if (state.readingPosition) restoreReaderAnchor(state.readingPosition);
    state.readingTransition = false;
    onComplete?.();
    $("reader-sheet").dataset.motion = "settled";
    return;
  }
  let last = performance.now();
  function tick(now) {
    const dt = Math.max(0, (now - last) / 1000);
    last = now;
    const frame = advanceSpring({ position: state.y, velocity: state.velocity }, state.target, dt);
    const crossesFullStop = state.target === targetY("full") && state.y >= 0 && frame.position < 0;
    const crossesClosedStop = state.target === targetY("closed") && state.y <= targetY("closed") && frame.position > targetY("closed");
    state.y = crossesFullStop || crossesClosedStop ? state.target : frame.position;
    state.velocity = crossesFullStop || crossesClosedStop ? 0 : frame.velocity;
    paintSheet();
    if (Math.abs(state.target - state.y) > 0.4 || Math.abs(state.velocity) > 4)
      state.raf = requestAnimationFrame(tick);
    else {
      state.y = state.target;
      paintSheet();
      if (state.readingPosition) restoreReaderAnchor(state.readingPosition);
      state.readingTransition = false;
      onComplete?.();
      $("reader-sheet").dataset.motion = "settled";
    }
  }
  state.raf = requestAnimationFrame(tick);
}
function openRoute(
  route,
  detent = "full",
  { capture = true, restoreScroll = null, exposeQuote = null } = {},
) {
  if (capture) captureComposer();
  if (!["note", "original"].includes(route)) state.previewQuote = null;
  if (state.closingFrame) state.returnFrame = null;
  state.closingFrame = null;
  setClosingControls(false);
  state.route = route;
  hideSelectionMenu();
  setReadingIntent("sheet");
  $("reader-sheet").inert = false;
  $("reader-sheet").hidden = false;
  renderBody();
  const scrollRevision = state.scrollRevision || 0;
  snap(detent, {
    onComplete: () => {
      if (
        restoreScroll !== null &&
        state.route === route &&
        (state.scrollRevision || 0) === scrollRevision
      )
        $("sheet-body").scrollTop = restoreScroll;
      if (exposeQuote) exposeSelectedQuote(exposeQuote);
    },
  });
  setStudy(
    {
      companion: "半屏陪读",
      discussion: "展开讨论",
      citation: "出处有回程",
      original: "同段核对",
      note: "自己的笔记",
      library: "自己的书房",
      records: "从记录回到原句",
      contents: "章节与段落",
      appearance: "排版不丢位置",
    }[route] || "阅读",
    route === "companion"
      ? "上方正文可以继续读。所提问题仍绑定原来的选文，收起后保留最新阅读位置。"
      : route === "citation"
        ? "出处是临时核对，返回讨论会恢复草稿、回答位置与面板高度。"
        : "每个入口都有清楚的对象与返回路径。",
  );
}
function setClosingControls(closing) {
  for (const node of [$("sheet-header"), $("sheet-body"), $("composer")]) node.inert = closing;
  $("reader-sheet").dataset.closing = String(closing);
}
function restoreClosingPanel() {
  const frame = state.closingFrame;
  if (!frame) return false;
  cancelAnimationFrame(state.raf);
  state.closingFrame = null;
  state.route = frame.route;
  state.detent = frame.detent;
  state.target = targetY(frame.detent);
  state.returnFrame = frame.returnFrame;
  setReadingIntent("sheet");
  $("reader-sheet").inert = false;
  setClosingControls(false);
  setStudy("已回到原来的面板", "关闭已取消，原句、问题和草稿仍然保留。");
  return true;
}
function closeSheet({ immediate = false, focus = true } = {}) {
  if (state.route === "closed" && $("reader-sheet").hidden) return;
  captureComposer();
  if (state.route !== "closed") state.closingFrame = { route: state.route, detent: state.detent, returnFrame: state.returnFrame };
  state.route = "closed";
  setReadingIntent("pure");
  $("reader-sheet").inert = false;
  setClosingControls(true);
  $("reading-scroll").inert = false;
  $("reading-scroll").style.paddingBottom = "24px";
  hideSelectionMenu();
  snap("closed", {
    immediate,
    onComplete: () => {
      if (state.route === "closed") {
        $("reader-sheet").hidden = true;
        $("reader-sheet").inert = true;
        state.closingFrame = null;
        state.returnFrame = null;
        state.previewQuote = null;
        setClosingControls(false);
      }
    },
  });
  persist();
  setStudy(
    "继续阅读",
    "保留你刚才主动读到的位置。需要回到提问处时，再点“返回提问原句”。",
  );
  if (focus) $("reading-scroll").focus({ preventScroll: true });
}
function exposeSelectedQuote(quote) {
  if (quote.layer !== state.layer) return;
  const text = $(quote.passageId)?.querySelector(".passage-text");
  if (!text) return;
  let box = text.getBoundingClientRect();
  if (text.firstChild?.nodeType === 3 && Number.isInteger(quote.startUtf16) && Number.isInteger(quote.endUtf16) && quote.endUtf16 <= text.firstChild.length) {
    const range = document.createRange();
    range.setStart(text.firstChild, quote.startUtf16); range.setEnd(text.firstChild, quote.endUtf16);
    box = range.getBoundingClientRect();
  }
  const reading = $("reading-scroll").getBoundingClientRect(), sheet = $("reader-sheet").getBoundingClientRect();
  if (box.top < sheet.top - 44 && box.bottom > reading.top + 8) return;
  $("reading-scroll").scrollTop += box.top - reading.top - 40;
  state.readingPosition = captureReadingPosition($("reading-scroll"), readerIdentity(), quote.passageId) || state.readingPosition;
  state.readingTop = $("reading-scroll").scrollTop;
  rememberReadingGeometry();
  persist();
}
function captureComposer() {
  if (state.route === "note") {
    state.noteDrafts[quoteKey(viewQuote())] = $("note-field")?.value || "";
    persist();
    return;
  }
  if (!["companion", "discussion"].includes(state.route)) return;
  state.draft = $("question-input").value;
  persist();
}
function visitCitation() {
  captureComposer();
  state.returnFrame = {
    route: state.route,
    detent: state.detent,
    scrollTop: $("sheet-body").scrollTop,
    draft: state.draft,
    quote: { ...state.quote },
    question: state.question,
    answered: state.answered,
  };
  openRoute("citation", "full");
}
function backToDiscussion() {
  if (state.route === "note") captureComposer();
  const frame = state.returnFrame;
  if (frame) {
    state.returnFrame = null;
    state.draft = frame.draft;
    if (frame.quote) state.quote = { ...frame.quote };
    state.question = frame.question || "";
    state.answered = !!frame.answered;
    openRoute(frame.route, frame.detent, {
      capture: false,
      restoreScroll: frame.scrollTop,
    });
  } else openRoute("discussion", "full", { capture: false });
}
function jumpTo(id, { close = true } = {}) {
  if (close) closeSheet();
  const p = $(id);
  if (p?.hasAttribute("data-passage")) {
    $("reading-scroll").scrollTop = p.offsetTop - 24;
    state.readingPosition = captureReadingPosition($("reading-scroll"), readerIdentity(), id) || state.readingPosition;
    state.readingTop = $("reading-scroll").scrollTop;
    rememberReadingGeometry();
  }
  persist();
}
function action(name) {
  if (name === "continue") {
    closeSheet();
    return;
  }
  if (name === "citation") {
    visitCitation();
    return;
  }
  if (name === "return-quote") {
    jumpTo((state.route === "note" || state.route === "original" ? viewQuote() : state.quote).passageId, { close: false });
    notify(state.route === "note" ? "已回到笔记原句" : "已回到提问原句");
    return;
  }
  if (name === "expand") {
    state.discussionStarted = true;
    openRoute("discussion", "full");
    return;
  }
  if (name === "ask-current") {
    const route = state.route === "discussion" ? "discussion" : "companion", detent = state.detent;
    takeQuote(currentReadingQuote(), { open: false });
    state.discussionStarted = true;
    persist();
    openRoute(route, detent, { capture: false });
    return;
  }
  if (name === "note") {
    captureComposer();
    state.returnFrame = {
      route: state.route,
      detent: state.detent,
      scrollTop: $("sheet-body").scrollTop,
      draft: state.draft,
      quote: { ...state.quote },
      question: state.question,
      answered: state.answered,
    };
    openRoute("note", "full");
    return;
  }
  if (name === "save-note") {
    const draftText = $("note-field")?.value || "", text = draftText.trim();
    if (!text) {
      $("note-field")?.focus();
      return;
    }
    const note = { id: "prototype-note-" + crypto.randomUUID(), text, quote: { ...viewQuote() }, author: "user" };
    state.notes.unshift(note);
    state.noteDrafts[quoteKey(viewQuote())] = "";
    $("note-field").value = "";
    persist();
    if (state.returnFrame) backToDiscussion();
    else closeSheet();
    state.noteSaveUndo = { note: { ...note, quote: { ...note.quote } }, draftText };
    notify("笔记已保存", { undo: true });
    return;
  }
  if (name === "undo-note-save") {
    captureComposer();
    const result = undoNoteSave({ notes: state.notes, drafts: state.noteDrafts, receipt: state.noteSaveUndo });
    if (result.status !== "undone") {
      notify(result.status === "conflict" ? "这句已有新草稿，两份内容都已保留" : "这次保存已完成，可在记录中查看");
      return;
    }
    state.notes = result.notes;
    state.noteDrafts = result.drafts;
    persist();
    openNotePreview(result.quote, { capture: false });
    notify("已恢复为草稿");
    return;
  }
  if (name === "retry") {
    if (state.offline) {
      notify("仍在断网示例中，问题已保留");
      return;
    }
    if (state.pendingTurn) {
      const turn = state.pendingTurn;
      if (
        state.draft.trim() &&
        (quoteKey(state.quote) !== quoteKey(turn.quote) ||
          state.draft.trim() !== turn.question)
      )
        state.drafts.push({ quote: { ...state.quote }, draft: state.draft });
      state.quote = { ...turn.quote };
      state.question = turn.question;
      state.draft = "";
      $("question-input").value = "";
      rememberTurn({ ...turn, answered: true });
      state.pendingTurn = null;
    }
    state.answered = true;
    state.discussionStarted = true;
    persist();
    renderBody();
    notify("已恢复示例讲解");
    return;
  }
  openRoute(name, "full");
}
document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.selection) {
    const selected = state.pendingSelection || initialQuote();
    const returnFromSelection = state.selectionReturnFrame;
    if (button.dataset.selection === "explain") {
      takeQuote(selected, { open: false });
      state.discussionStarted = true;
      persist();
    } else {
      captureComposer();
      state.previewQuote = { ...selected };
      if (returnFromSelection) state.returnFrame = returnFromSelection;
      else if (["companion", "discussion"].includes(state.route)) state.returnFrame = { route: state.route, detent: state.detent, scrollTop: $("sheet-body").scrollTop, draft: state.draft, quote: { ...state.quote }, question: state.question, answered: state.answered };
      else if (!["note", "original"].includes(state.route)) state.returnFrame = null;
      hideSelectionMenu();
      window.getSelection()?.removeAllRanges();
    }
    openRoute(
      button.dataset.selection === "explain"
        ? "companion"
        : button.dataset.selection,
      button.dataset.selection === "explain" ? "half" : "full",
      { capture: false, exposeQuote: button.dataset.selection === "explain" ? selected : null },
    );
    return;
  }
  if (button.dataset.action) {
    action(button.dataset.action);
    return;
  }
  if (button.dataset.noteDraft !== undefined) {
    const draft = noteDraftEntries().find(d => d.key === button.dataset.noteDraft);
    if (draft) openNotePreview(draft.quote);
    return;
  }
  if (button.dataset.layer) {
    state.layer = button.dataset.layer;
    renderReader();
    renderBody();
    persist();
    return;
  }
  if (button.dataset.size) {
    state.size = Math.max(
      18,
      Math.min(28, state.size + Number(button.dataset.size)),
    );
    renderReader();
    renderBody();
    persist();
    return;
  }
  if (button.dataset.theme) {
    state.theme = button.dataset.theme;
    renderReader();
    renderBody();
    persist();
    return;
  }
  if (button.dataset.jump) {
    jumpTo(button.dataset.jump);
    return;
  }
  if (button.dataset.record !== undefined) {
    const note = state.notes[Number(button.dataset.record)];
    jumpTo(note.quote.passageId);
    return;
  }
  if (button.dataset.turn !== undefined) {
    const turn = state.turns[Number(button.dataset.turn)];
    if (turn.answered === false) rememberPendingTurn(turn.id);
    takeQuote({ ...turn.quote }, { open: false });
    state.question = turn.question;
    state.answered = turn.answered !== false;
    if (turn.answered === false) state.pendingTurn = { ...turn, quote: { ...turn.quote } };
    state.discussionStarted = true;
    persist();
    openRoute("discussion", "full", { capture: false });
    return;
  }
  if (button.dataset.recordTab) {
    state.recordsTab = button.dataset.recordTab;
    renderBody();
    return;
  }
  if (button.dataset.scenario) showScenario(button.dataset.scenario);
});
$("library-button").onclick = () => openRoute("library", "full");
$("contents-button").onclick = () => openRoute("contents", "full");
$("progress-button").onclick = () => openRoute("contents", "full");
$("appearance-button").onclick = () => openRoute("appearance", "full");
$("companion-button").onclick = enterCompanion;
$("wake-top").onclick = () => wakeReadingTools("top");
$("wake-bottom").onclick = () => wakeReadingTools("progress");
$("sheet-done").onclick = closeSheet;
$("sheet-back").onclick = backToDiscussion;
$("sheet-scrim").onclick = () => snap("half");
$("night-mode").onclick = () => {
  state.theme = state.theme === "paper" ? "night" : "paper";
  renderReader();
  persist();
};
$("offline-mode").onchange = (event) => {
  state.offline = event.target.checked;
  if (["companion", "discussion"].includes(state.route)) renderBody();
  setStudy(
    state.offline ? "断网仍可读" : "连接恢复示例",
    state.offline
      ? "原文与已缓存内容继续可读，问题和选文仍保留。"
      : "已有问题可以显式重试。",
  );
};
$("reopen").onclick = () => {
  captureComposer();
  persist();
  location.reload();
};
$("question-input").oninput = (event) => {
  state.draft = event.target.value;
  persist();
};
$("question-input").onfocus = () => snap("full");
$("question-form").onsubmit = (event) => {
  event.preventDefault();
  const question = $("question-input").value.trim();
  if (!question) return;
  state.question = question;
  state.answered = false;
  state.discussionStarted = true;
  const turn = {
    id: "prototype-" + Date.now(),
    question,
    quote: { ...state.quote },
    answered: !state.offline,
  };
  rememberPendingTurn();
  state.pendingTurn = turn;
  if (!state.offline) {
    rememberTurn(turn);
    state.pendingTurn = null;
    state.draft = "";
    state.answered = true;
  }
  persist();
  $("question-input").value = state.draft;
  openRoute("discussion", "full", { capture: false });
};
$("draft-return").onclick = () => {
  captureComposer();
  const previous = state.drafts.pop();
  if (!previous) return;
  if (state.draft.trim())
    state.drafts.unshift({ quote: { ...state.quote }, draft: state.draft });
  state.quote = previous.quote;
  state.draft = previous.draft;
  state.question = "";
  state.answered = false;
  state.discussionStarted = true;
  state.returnFrame = null;
  persist();
  renderBody();
};
$("reading-scroll").addEventListener(
  "scroll",
  () => {
    state.readingTop = $("reading-scroll").scrollTop;
    if (!state.restoringReading && !state.readingTransition && readingGeometryMatches())
      state.readingPosition = captureReadingPosition($("reading-scroll"), readerIdentity()) || state.readingPosition;
    persist();
    updateProgress();
    if (!state.progressAdjusting && !state.restoringReading && performance.now() > state.progressScrollUntil) setReadingIntent("read");
    if (!$("selection-menu").hidden) requestAnimationFrame(positionSelectionMenu);
  },
  { passive: true },
);
for (const type of ["wheel", "touchstart", "pointerdown", "keydown"])
  $("reading-scroll").addEventListener(type, () => {
    if (type === "wheel") setReadingIntent("read");
    state.restoringReading = false;
    state.readingTransition = false;
    $("reading-scroll").removeAttribute("data-restoring");
  }, { passive: true });
document.addEventListener("selectionchange", () => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    if (state.readingIntent.kind === "selection" && !state.touchHold) hideSelectionMenu();
    return;
  }
  if (state.lastPointerType !== "mouse" && !state.touchSelectionArmed) return;
  presentSelection(selection.getRangeAt(0));
});
function cancelTouchHold() {
  clearTimeout(cancelTouchHold.timer);
  state.touchHold = null;
}
$("reading-scroll").addEventListener("pointerdown", event => {
  state.lastPointerType = event.pointerType || "mouse";
  if (state.touchHold && state.touchHold.id !== event.pointerId) return cancelTouchHold();
  const text = event.target.closest?.(".passage-text");
  if (!text) return;
  if (state.readingIntent.kind !== "selection") state.touchSelectionArmed = false;
  state.touchHold = startHold({ id: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY, passageId: text.closest("[data-passage]").dataset.passage, isPrimary: event.isPrimary, button: event.button }, performance.now());
  if (!state.touchHold) return;
  cancelTouchHold.timer = setTimeout(() => {
    if (!holdReady(state.touchHold, performance.now())) return;
    state.touchSelectionArmed = true;
    selectPassage(state.touchHold.passageId);
  }, HOLD_MS);
}, { passive: true });
$("reading-scroll").addEventListener("pointermove", event => {
  state.touchHold = moveHold(state.touchHold, { id: event.pointerId, x: event.clientX, y: event.clientY });
  if (state.touchHold?.cancelled) {
    clearTimeout(cancelTouchHold.timer);
    setReadingIntent("read");
  }
}, { passive: true });
for (const type of ["pointerup", "pointercancel"]) $("reading-scroll").addEventListener(type, cancelTouchHold, { passive: true });
$("reading-scroll").addEventListener("contextmenu", event => {
  if (!event.target.closest?.(".passage-text") || state.lastPointerType === "mouse") return;
  state.touchSelectionArmed = true;
  const selection = window.getSelection();
  if (selection?.rangeCount && !selection.isCollapsed) presentSelection(selection.getRangeAt(0));
  else selectPassage(event.target.closest("[data-passage]").dataset.passage);
  // Keep native copying and selection controls; this prototype does not replace
  // an operating system edit-menu implementation.
});
document.addEventListener("keydown", (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  if ((event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) && event.target.closest?.("#reading-scroll")) {
    event.preventDefault();
    state.touchSelectionArmed = true;
    const selection = window.getSelection();
    if (selection?.rangeCount && !selection.isCollapsed) presentSelection(selection.getRangeAt(0));
    else selectPassage(currentReadingQuote().passageId);
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (state.route === "citation") backToDiscussion();
    else if (!$("selection-menu").hidden) { hideSelectionMenu(); window.getSelection()?.removeAllRanges(); }
    else if (state.route !== "closed") closeSheet();
    else setReadingIntent("pure");
  }
});
$("selection-menu").addEventListener("mousedown", event => event.preventDefault());
let outsideSelectionPress = null;
document.addEventListener("pointerdown", event => {
  outsideSelectionPress = null;
  if (event.button !== 0 || event.isPrimary === false || $("selection-menu").hidden || $("selection-menu").contains(event.target)) return;
  if (event.target.closest?.("#reading-scroll")) outsideSelectionPress = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0, startedAt: performance.now() };
  else hideSelectionMenu();
});
document.addEventListener("pointermove", event => {
  const press = outsideSelectionPress;
  if (press?.id === event.pointerId) press.distance = Math.max(press.distance, Math.hypot(event.clientX - press.x, event.clientY - press.y));
}, { passive: true });
document.addEventListener("pointerup", event => {
  const press = outsideSelectionPress;
  if (press?.id !== event.pointerId) return;
  outsideSelectionPress = null;
  // A completed long press owns its new selection. Secondary clicks retain the
  // native range for the browser copy menu. Only a primary short tap cancels.
  if (event.button === 0 && performance.now() - press.startedAt < HOLD_MS && Math.max(press.distance, Math.hypot(event.clientX - press.x, event.clientY - press.y)) < 6) { hideSelectionMenu(); window.getSelection()?.removeAllRanges(); }
}, { passive: true });
document.addEventListener("pointercancel", () => { outsideSelectionPress = null; }, { passive: true });
const grip = $("sheet-grip");
grip.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || state.drag) return;
  const interruptedClosing = restoreClosingPanel();
  cancelAnimationFrame(state.raf);
  $("reader-sheet").dataset.motion = "dragging";
  state.readingTransition = true;
  grip.dataset.dragging = "true";
  state.velocity = 0;
  state.drag = {
    id: event.pointerId,
    startY: event.clientY,
    start: state.y,
    previousY: event.clientY,
    time: performance.now(),
    velocity: 0,
    maxDistance: 0,
    interruptedClosing,
    samples: [{ y: event.clientY, time: performance.now() }],
  };
  grip.setPointerCapture(event.pointerId);
  paintSheet();
});
grip.addEventListener("pointermove", (event) => {
  const d = state.drag;
  if (!d || d.id !== event.pointerId) return;
  const now = performance.now();
  d.samples.push({ y: event.clientY, time: now });
  while (d.samples.length > 2 && now - d.samples[0].time > 80) d.samples.shift();
  const first = d.samples[0];
  d.velocity = (event.clientY - first.y) / Math.max(1, now - first.time) * 1000;
  d.previousY = event.clientY;
  d.time = now;
  d.maxDistance = Math.max(d.maxDistance, Math.abs(event.clientY - d.startY));
  const candidate = d.start + event.clientY - d.startY;
  const extent = Math.max(1, Math.min(16, phoneHeight() * 0.12 - document.querySelector(".status-bar").clientHeight - 8));
  state.y = resistedPosition(candidate, 0, targetY("closed"), extent);
  paintSheet();
});
function endDrag(event) {
  const d = state.drag;
  if (!d || d.id !== event.pointerId) return;
  state.drag = null;
  delete grip.dataset.dragging;
  const moved = Math.max(d.maxDistance, Math.abs(event.clientY - d.startY));
  if (moved < 5) {
    snap(d.interruptedClosing ? state.detent : state.detent === "full" ? "half" : "full");
    return;
  }
  let velocity = performance.now() - d.time > 100 ? 0 : d.velocity;
  if ((state.y < 0 && velocity < 0) || (state.y > targetY("closed") && velocity > 0)) velocity = 0;
  state.velocity = velocity;
  const stops = [
    ["full", targetY("full")],
    ["half", targetY("half")],
    ["closed", targetY("closed")],
  ];
  const destination = nearestDetent(state.y, velocity, stops);
  if (destination === "closed") closeSheet();
  else snap(destination);
}
grip.addEventListener("pointerup", endDrag);
function cancelDrag() {
  if (!state.drag) return;
  state.drag = null;
  delete grip.dataset.dragging;
  state.velocity = 0;
  snap(state.detent);
}
grip.addEventListener("pointercancel", cancelDrag);
grip.addEventListener("lostpointercapture", cancelDrag);
function showScenario(name) {
  if (["top", "progress"].includes(name)) {
    closeSheet({ immediate: true });
    wakeReadingTools(name);
    return;
  }
  if (name === "resume") {
    closeSheet();
    hideSelectionMenu();
    setReadingIntent("pure");
    jumpTo(paragraphs[0].id);
    return;
  }
  if (name === "selected") {
    closeSheet();
    jumpTo(paragraphs[0].id);
    selectPassage(paragraphs[0].id);
    return;
  }
  if (name === "citation") {
    if (!["companion", "discussion"].includes(state.route))
      openRoute("discussion", "full");
    visitCitation();
    return;
  }
  if (name === "note") {
    if (state.route === "closed") openRoute("companion", "half");
    action("note");
    return;
  }
  if (name === "night") {
    state.theme = "night";
    renderReader();
    openRoute("companion", "half");
    return;
  }
  if (name === "offline") {
    state.offline = true;
    $("offline-mode").checked = true;
    openRoute("companion", "half");
    return;
  }
  openRoute(name, name === "companion" ? "half" : "full");
}
drawIcons();
renderReader({ restore: false });
const hadStoredLocator = saved.readingPosition != null;
const restoredReading = state.readingPosition && restoreReaderAnchor(state.readingPosition);
if (!restoredReading) {
  $("reading-scroll").scrollTop = hadStoredLocator ? 0 : state.readingTop;
  state.readingTop = $("reading-scroll").scrollTop;
  state.readingPosition = captureReadingPosition($("reading-scroll"), readerIdentity());
  const entry = state.readingPosition?.passageId || paragraphs[0].id;
  if (entry !== state.resumePassageId) {
    state.resumePassageId = entry;
    renderReader();
  }
}
rememberReadingGeometry();
state.y = targetY("closed");
setStudy("整屏是书", "点顶部边界看导航，点底部边界调进度；长按文字后再解释、核对或记一句。");
setReadingIntent("pure");
updateProgress();
updateContextChrome();
window.addEventListener("resize", () => {
  if (state.readingPosition) restoreReaderAnchor(state.readingPosition);
  if (state.route !== "closed") snap(state.detent, { immediate: true });
  positionSelectionMenu();
});
window.addEventListener("pagehide", persist);
const params = new URLSearchParams(location.search);
if (params.get("state")) showScenario(params.get("state"));

grip.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    const interruptedClosing = restoreClosingPanel();
    snap(interruptedClosing ? state.detent : state.detent === "full" ? "half" : "full");
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "note-field") {
    state.noteDrafts[quoteKey(viewQuote())] = event.target.value;
    persist();
  }
});

for (const event of ["wheel", "touchstart", "keydown"])
  $("sheet-body").addEventListener(
    event,
    () => {
      state.scrollRevision = (state.scrollRevision || 0) + 1;
    },
    { passive: true },
  );

document.addEventListener("pointerdown", () => { keyboardTools = false; }, true);
document.addEventListener("keydown", () => { keyboardTools = true; }, true);
for (const [id,kind] of [["reader-nav","top"],["reading-dock","progress"]]) {
  $(id).addEventListener("focusin", () => { if (keyboardTools && state.readingIntent.kind === kind) setReadingIntent("pin"); });
  $(id).addEventListener("focusout", () => queueMicrotask(() => { if (!$(id).contains(document.activeElement) && state.readingIntent.kind === kind) setReadingIntent("unpin"); }));
}
for (const id of ["wake-top","wake-bottom"]) $(id).addEventListener("focusout", () => queueMicrotask(() => {
  if (![ $("reader-nav"), $("reading-dock") ].some(n => n.contains(document.activeElement))) setReadingIntent("unpin");
}));
const progress = $("reading-progress");
function releaseProgress() {
  state.progressAdjusting = false;
  state.progressScrollUntil = performance.now() + 150;
  if (keyboardTools && $("reading-dock").contains(document.activeElement)) setReadingIntent("pin");
  else setReadingIntent("unpin");
}
progress.addEventListener("pointerdown", () => { state.progressAdjusting = true; setReadingIntent("pin"); });
progress.addEventListener("input", () => {
  state.progressAdjusting = true;
  const position = positionAtProgress(Number(progress.value) / 1000, paragraphs, readerIdentity());
  if (!position) return;
  state.readingPosition = position;
  restoreReaderAnchor(position);
  state.readingTop = $("reading-scroll").scrollTop;
  rememberReadingGeometry();
  updateProgress();
  persist();
});
for (const type of ["change","pointerup","pointercancel"]) progress.addEventListener(type, releaseProgress);
