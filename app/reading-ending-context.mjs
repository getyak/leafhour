import {normalizeReadingSession} from './reading-session-record.mjs';
export function restoreReadingEnding(saved,book){if(!saved||saved.status!=='finished')return null;try{const snapshot=normalizeReadingSession(saved,book);return {snapshot,anchor:{...snapshot.end},durationSeconds:snapshot.durationSeconds};}catch{return null;}}
