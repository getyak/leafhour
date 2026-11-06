import {createHash} from 'node:crypto';
export const EXECUTION_PROTOCOL=1;
export const EXECUTION_TYPES=Object.freeze(['document-extract','document-metadata','pdf-structure','pdf-split','pdf-inspect','web-search','chat','annotation','companion','introduction','reading-guide','notebook','person','translation','gift-quote','speech','dialogue','listening-guide','cover','ocr-submit','ocr-recover','ocr-status','ocr-result']);
export const executionError=(code,status=409)=>Object.assign(Error(code),{code,status});
export function exactObject(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw executionError('invalid_execution_message',400);return value;}
export function identifier(value){if(typeof value!=='string'||!value||value.length>512||/[\u0000-\u001f]/u.test(value))throw executionError('invalid_execution_identifier',400);return value;}
function canonical(value){if(value===null||typeof value!=='object')return value;if(Array.isArray(value))return value.map(canonical);return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));}
export function digest(value){return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}
// Wire values are data only. Functions, AbortSignals and user credentials never cross.
export function encodeData(value){
 if(value===undefined)return null;
 if(Buffer.isBuffer(value)||value instanceof Uint8Array)return {$leafhourBytes:Buffer.from(value).toString('base64')};
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
 if(Array.isArray(value))return value.map(encodeData);
 if(typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){if(Object.keys(value).length===1&&typeof value.$leafhourBytes==='string'){const bytes=Buffer.from(value.$leafhourBytes,'base64');if(bytes.toString('base64')!==value.$leafhourBytes)throw executionError('invalid_binary_input',400);return value;}return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,encodeData(v)]));}
 throw executionError('non_data_execution_input',400);
}
export function decodeData(value){if(Buffer.isBuffer(value)||value instanceof Uint8Array)return Buffer.from(value);if(value&&typeof value==='object'){if(Object.keys(value).length===1&&typeof value.$leafhourBytes==='string'){const bytes=Buffer.from(value.$leafhourBytes,'base64');if(bytes.toString('base64')!==value.$leafhourBytes)throw executionError('invalid_binary_input',400);return bytes;}return Array.isArray(value)?value.map(decodeData):Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decodeData(v)]));}return value;}
export function validateLease(value){exactObject(value,['id','token','fence','workerId']);identifier(value.id);identifier(value.token);identifier(value.workerId);if(!Number.isSafeInteger(value.fence)||value.fence<1)throw executionError('invalid_lease',400);return value;}

export function validToolArguments(value,schema){
 if(!schema||typeof schema!=='object')return false;
 if(Object.hasOwn(schema,'const'))return JSON.stringify(value)===JSON.stringify(schema.const);
 if(schema.enum&&!schema.enum.some(item=>JSON.stringify(item)===JSON.stringify(value)))return false;
 if(schema.anyOf)return schema.anyOf.some(item=>validToolArguments(value,item));
 if(schema.oneOf)return schema.oneOf.filter(item=>validToolArguments(value,item)).length===1;
 if(schema.allOf)return schema.allOf.every(item=>validToolArguments(value,item));
 if(schema.type==='null')return value===null;
 if(schema.type==='object')return !!value&&typeof value==='object'&&!Array.isArray(value)&&(schema.required||[]).every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>Object.hasOwn(schema.properties||{},key)?validToolArguments(value[key],schema.properties[key]):schema.additionalProperties!==false);
 if(schema.type==='string')return typeof value==='string'&&value.isWellFormed()&&value.length>=(schema.minLength||0)&&value.length<=(schema.maxLength??Infinity)&&(!schema.pattern||new RegExp(schema.pattern,'u').test(value));
 if(schema.type==='integer')return Number.isSafeInteger(value)&&value>=(schema.minimum??-Infinity)&&value<=(schema.maximum??Infinity);
 if(schema.type==='number')return Number.isFinite(value)&&value>=(schema.minimum??-Infinity)&&value<=(schema.maximum??Infinity);
 if(schema.type==='boolean')return typeof value==='boolean';
 if(schema.type==='array')return Array.isArray(value)&&value.length>=(schema.minItems||0)&&value.length<=(schema.maxItems??Infinity)&&(!schema.uniqueItems||new Set(value.map(item=>JSON.stringify(item))).size===value.length)&&value.every(item=>validToolArguments(item,schema.items));
 return false;
}

export const LOCAL_EXECUTION_TYPES=Object.freeze(['document-extract','document-metadata','pdf-structure','pdf-split','pdf-inspect']);
