export const ESTIMATE_IDLE_MS=120000;
export const READING_TIME_SOURCES=Object.freeze(['reader_focus','reader_estimate','manual']);
export const isReadingTimeSource=value=>READING_TIME_SOURCES.includes(value);
export const readingTimeSourceLabel=value=>({reader_focus:'主动专注',reader_estimate:'前台估计',manual:'手动补记（自报）'}[value]||'旧预览记录');
export const READING_TIME_MEANING='总时长按所有书籍、设备与口径的区间合并，重叠只计一次；各口径分别去重，彼此可能重叠，不能相加。前台估计在2分钟无操作后暂停；主动专注允许停留思考，隐藏、失焦或手动暂停时不计。手动补记为自报，时长不代表理解程度。';
