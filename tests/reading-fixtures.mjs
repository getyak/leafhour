export const readingBook={
  bookId:'reading-test',contentVersion:'edition-1',title:{zh:'A real test book',en:'A real test book'},author:'Test fixture',
  source:{format:'txt',sha256:'edition-1'},chapters:[{id:'ch01',number:1,kind:'body',title:{zh:'Opening'}},{id:'ch02',number:2,kind:'body',title:{zh:'Continuation'}}],
  sections:[{number:1,chapterId:'ch01',paragraphs:[{id:'p1',original:'Read this first.',translations:{},annotationIds:[],termIds:[]},{id:'p2',original:'Keep your own question.',translations:{},annotationIds:[],termIds:[]}]},{number:2,chapterId:'ch02',paragraphs:[{id:'p3',original:'Continue from here.',translations:{},annotationIds:[],termIds:[]},{id:'p4',original:'This is the closing paragraph.',translations:{},annotationIds:[],termIds:[]}]}],
  annotations:[],glossary:[],readingStart:{chapterId:'ch01',passageId:'p1'}
};
export const readingRecords=()=>({kind:'marginalia-personal-records',schemaVersion:3,bookId:'reading-test',contentVersion:'edition-1',comments:[],questions:[],readingSessions:[],readingMilestones:[],position:null});
export const focusSession=(patch={})=>({id:'focus-1',bookId:'reading-test',contentVersion:'edition-1',source:'reader_focus',sequence:1,status:'paused',startedAt:'2026-10-14T12:00:00.000Z',endedAt:'2026-10-14T12:10:00.000Z',timeZone:'Asia/Singapore',start:{chapterId:'ch01',passageId:'p1'},end:{chapterId:'ch01',passageId:'p2'},segments:[{startedAt:'2026-10-14T12:00:00.000Z',endedAt:'2026-10-14T12:04:00.000Z'},{startedAt:'2026-10-14T12:08:00.000Z',endedAt:'2026-10-14T12:10:00.000Z'}],durationSeconds:360,...patch});
