export const ESTIMATE_IDLE_MS=120000;
export const READING_TIME_SOURCES=Object.freeze(['reader_focus','reader_estimate','manual']);
export const isReadingTimeSource=value=>READING_TIME_SOURCES.includes(value);
// Pure helper with explicit caller-supplied label data for localized UIs; the
// stable source codes below are the shared descriptors. The small legacy label
// map stays only as the default for existing non-localized callers and is
// tree-shaken out of the reader bundle whenever the caller supplies labels.
export const READING_TIME_SOURCE_IDS=Object.freeze({reader_focus:'reading.time.source.reader_focus',reader_estimate:'reading.time.source.reader_estimate',manual:'reading.time.source.manual',legacy:'reading.time.source.legacy'});
export const READING_TIME_MEANING_ID='reading.time.meaning';
const LEGACY_SOURCE_LABELS=Object.freeze({reader_focus:'主动专注',reader_estimate:'前台估计',manual:'手动补记（自报）',legacy:'旧预览记录'});
export const readingTimeSourceLabel=(value,labels)=>(labels&&labels[value])||(labels&&labels.legacy)||LEGACY_SOURCE_LABELS[value]||LEGACY_SOURCE_LABELS.legacy;
// Server reporting keeps the authored meaning text; the browser UI reads the
// localized catalogue entry through READING_TIME_MEANING_ID instead.
export const READING_TIME_MEANING='总时长按所有书籍、设备与口径的区间合并，重叠只计一次；各口径分别去重，彼此可能重叠，不能相加。前台估计在2分钟无操作后暂停；主动专注允许停留思考，隐藏、失焦或手动暂停时不计。手动补记为自报，时长不代表理解程度。';
