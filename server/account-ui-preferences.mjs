// GET-198 first bounded batch: the account UI-language preference record.
// One owner-scoped `ui-preferences.json` beside the account profile and the
// reading defaults, never inside them and never on any book. The record only
// stores the interface language choice; reading language and reading mode are
// owned by reading-preferences and must not change here. Persistence reuses the
// account-profile paradigm: serial per-file queue, private atomic rename for
// local runs, and the hosted dataStore mutate/CAS transaction otherwise.
//
// Both supported versions have the same exact five-field document shape.
// Version 1 null means no account choice; version 2 also accepts explicit system.
// A missing record is the initial v1 state and may be initialized; any existing
// document that is not that exact shape (foreign kind, unknown schemaVersion,
// unknown/missing fields, unsafe revision, non-object or primitive values) is
// corrupt data: reads and writes refuse it with 409 and leave it untouched.
// An empty view must never open a baseRevision-0 CAS window over existing data.
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {digest,fail} from './document-import.mjs';
import {isUiLocale,isUiPreference} from '../app/ui-locale-codec.mjs';

const queues=new Map();
const controls=/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const MAX_TIMESTAMP_LENGTH=64;
const RECORD_KEYS=['kind','schemaVersion','revision','updatedAt','uiLocale'];
const RECORD_KIND='marginalia-ui-preferences';
const emptyView=()=>({revision:0,updatedAt:null,uiLocale:null});
// The one missing-record fallback: a complete, supported v1 initial state. The
// dataStore fallback must distinguish this from real stored `{}`, `[]`, `null`
// and scalar values, which are invalid documents, not missing ones.
const initialRecord=()=>({kind:RECORD_KIND,schemaVersion:1,revision:0,updatedAt:null,uiLocale:null});
const invalidRecord=()=>fail('界面语言记录格式无法识别，已保持原样',409);
function accountFile(dataDir,user){
  if(typeof user?.id!=='string'||!user.id||user.id.length>512||controls.test(user.id))throw fail('请先进入自己的书房',401);
  return path.join(dataDir,'users',digest(user.id),'ui-preferences.json');
}
// Strict supported-version validation: exactly the five owned keys with valid values. A
// revision-0 record is the initial state only; saved records carry a timestamp.
function parseRecord(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw invalidRecord();
  const keys=Object.keys(value);
  if(keys.length!==RECORD_KEYS.length||!keys.every(key=>RECORD_KEYS.includes(key)))throw invalidRecord();
  if(value.kind!==RECORD_KIND||![1,2].includes(value.schemaVersion))throw invalidRecord();
  if(!Number.isSafeInteger(value.revision)||value.revision<0)throw invalidRecord();
  if(value.uiLocale!==null&&!(value.schemaVersion===2?isUiPreference(value.uiLocale):isUiLocale(value.uiLocale)))throw invalidRecord();
  if(value.revision===0){if(value.updatedAt!==null||value.uiLocale!==null)throw invalidRecord();}
  else if(typeof value.updatedAt!=='string'||!value.updatedAt||value.updatedAt.length>MAX_TIMESTAMP_LENGTH||!Number.isFinite(Date.parse(value.updatedAt)))throw invalidRecord();
  return value;
}
function view(record){
  parseRecord(record);
  return {revision:record.revision,updatedAt:record.updatedAt,uiLocale:record.uiLocale};
}
function requireInput(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail('界面语言请求格式不正确，尚未保存');
  const keys=Object.keys(input);
  if(keys.some(key=>!['baseRevision','uiLocale'].includes(key)))throw fail('界面语言请求包含未知字段，尚未保存');
  if(keys.length!==2)throw fail('界面语言请求缺少版本或语言，尚未保存');
  if(!Number.isSafeInteger(input.baseRevision)||input.baseRevision<0)throw fail('请先读取当前界面语言，再保存修改');
  if(input.uiLocale!==null&&!isUiPreference(input.uiLocale))throw fail('界面语言格式不正确，尚未保存');
}
export function createAccountUiPreferences({dataDir,dataStore=null}={}){
  if(typeof dataDir!=='string'||!dataDir)throw Error('Account UI preferences data directory is required');
  async function read(file){
    if(dataStore){
      const stored=await dataStore.read(file,initialRecord());
      // `undefined` is not a persistable JSON value; it can only mean the store
      // returned no row. Every other real value (including null) is validated.
      return stored===undefined?initialRecord():stored;
    }
    try{return JSON.parse(await readFile(file,'utf8'));}catch(error){
      if(error.code==='ENOENT')return initialRecord();
      if(error instanceof SyntaxError)throw invalidRecord();
      throw error;
    }
  }
  async function mutate(file,operation){
    if(dataStore)return dataStore.mutate(file,initialRecord(),operation);
    const previous=queues.get(file)||Promise.resolve(),work=previous.catch(()=>{}).then(async()=>{
      const data=await read(file),result=operation(data),pending=file+'.'+randomUUID()+'.pending';
      await mkdir(path.dirname(file),{recursive:true,mode:0o700});
      try{await writeFile(pending,JSON.stringify(data),{mode:0o600});await rename(pending,file);}finally{await unlink(pending).catch(error=>{if(error.code!=='ENOENT')throw error;});}
      return result;
    });
    queues.set(file,work);try{return await work;}finally{if(queues.get(file)===work)queues.delete(file);}
  }
  async function get(user){return view(await read(accountFile(dataDir,user)));}
  async function save(user,input){
    const file=accountFile(dataDir,user);
    requireInput(input);
    return mutate(file,data=>{
      // Refuse foreign or corrupt documents before any mutation; the callback
      // only ever mutates the persisted object itself, never a substitute.
      parseRecord(data);
      const revision=data.revision;
      if(revision!==input.baseRevision)throw fail('界面语言已在另一处更新，请刷新后重新保存',409);
      if(revision>=Number.MAX_SAFE_INTEGER)throw fail('界面语言版本已超过可保存范围',409);
      if(input.uiLocale==='system')data.schemaVersion=2;
      data.revision=revision+1;data.updatedAt=new Date().toISOString();data.uiLocale=input.uiLocale;
      return {revision:data.revision,updatedAt:data.updatedAt,uiLocale:input.uiLocale};
    });
  }
  return {get,save};
}
