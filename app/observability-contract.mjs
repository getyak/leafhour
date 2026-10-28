// Shared closed metadata contract. Unknown fields are discarded rather than
// copied; recognized fields with invalid values reject the complete event.
export const OBSERVABILITY_EVENT_NAMES=Object.freeze(['library_opened','reader_open_requested','reader_content_visible','reader_active','reader_resume_result','reader_load_failed','client_error','request_failed','ingestion_completed','ingestion_failed','chat_failed','companion_failed']);
export const OBSERVABILITY_LIMITS=Object.freeze({events:20,bytes:16*1024,durationMs:86400000});
const analytics=new Set(['library_opened','reader_open_requested','reader_content_visible','reader_active','reader_resume_result']);
const enums={page:['library','reader','other'],stage:['library','reader_open','reader_load','reader_visible','reader_active','reader_resume','ingestion','chat','companion','request','client'],outcome:['success','failure','cancelled','restored','fresh','missing','skipped'],resume:['restored','fresh','missing','failed','none'],client:['browser','server'],errorKind:['network','timeout','aborted','http','parse','render','storage','internal','unknown']};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=status=>Object.assign(new Error('Invalid observability metadata'),{status});
export function observabilityCategory(name){return OBSERVABILITY_EVENT_NAMES.includes(name)?analytics.has(name)?'analytics':'diagnostics':null;}
export function validateObservabilityEvent(value){
  if(!record(value)||!uuid.test(value.id)||!uuid.test(value.operationId)||!observabilityCategory(value.name)||!record(value.properties))return null;
  if(typeof value.occurredAt!=='string'||value.occurredAt.length!==24||!Number.isFinite(Date.parse(value.occurredAt))||new Date(value.occurredAt).toISOString()!==value.occurredAt)return null;
  const properties={};
  for(const [key,allowed] of Object.entries(enums)){if(value.properties[key]!==undefined){if(!allowed.includes(value.properties[key]))return null;properties[key]=value.properties[key];}}
  for(const [key,min,max] of [['durationMs',0,OBSERVABILITY_LIMITS.durationMs],['status',100,599]])if(value.properties[key]!==undefined){const n=value.properties[key];if(!Number.isSafeInteger(n)||n<min||n>max)return null;properties[key]=n;}
  return {id:value.id.toLowerCase(),operationId:value.operationId.toLowerCase(),name:value.name,occurredAt:value.occurredAt,properties};
}
export function validateObservabilityBatch(value){
  let bytes;try{bytes=new TextEncoder().encode(JSON.stringify(value)).length;}catch{throw fail(400);}
  if(bytes>OBSERVABILITY_LIMITS.bytes)throw fail(413);
  if(!record(value)||Object.keys(value).length!==1||!Array.isArray(value.events))throw fail(400);
  if(value.events.length>OBSERVABILITY_LIMITS.events)throw fail(413);
  const events=value.events.map(validateObservabilityEvent);if(events.some(event=>!event))throw fail(400);return events;
}
