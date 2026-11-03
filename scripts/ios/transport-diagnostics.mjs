import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const namedCodes=new Set(['STATE_ERROR','ENTITY_ERROR','PARAMETER_ERROR','FORBIDDEN','UNAUTHORIZED','NOT_FOUND','RATE_LIMITED']);
const boundedCode=code=>Number.isSafeInteger(code) && Math.abs(code)<1000000;
function category(message) {
  if(/(?:app.?icon|icon file|icon image|asset catalog)/i.test(message))return 'APP_ICON_VALIDATION';
  if(/(?:authenticat|permission|unauthorized|forbidden)/i.test(message))return 'AUTHORIZATION';
  if(/(?:network|timed? out|connection|could not resolve host|unable to connect)/i.test(message))return 'TRANSPORT_NETWORK';
  if(/(?:file does not exist|no such file|cannot open file)/i.test(message))return 'TRANSPORT_FILE';
  if(/(?:unknown|unrecognized|invalid) (?:argument|option)|missing required (?:argument|option)/i.test(message))return 'TRANSPORT_ARGUMENTS';
  return null;
}
function errorsIn(text) {
  try {
    const parsed=JSON.parse(text);
    return Array.isArray(parsed?.['product-errors'])?parsed['product-errors']:Array.isArray(parsed?.errors)?parsed.errors:null;
  } catch {return null;}
}
// altool's launcher emits a banner even when JSON was requested. Only inspect
// balanced JSON documents starting on their own line, respecting quoted braces.
function structuredErrors(text) {
  const direct=errorsIn(text);
  if(direct)return direct;
  const starts=/^\s*\{/gm;
  let match, attempts=0;
  while((match=starts.exec(text)) && attempts++<16) {
    const start=text.indexOf('{',match.index);
    let depth=0, quoted=false, escaped=false;
    for(let i=start;i<text.length;i++) {
      const char=text[i];
      if(quoted) {if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
      if(char==='"')quoted=true;
      else if(char==='{')depth++;
      else if(char==='}' && --depth===0) {
        const errors=errorsIn(text.slice(start,i+1));
        if(errors)return errors;
        starts.lastIndex=i+1;
        break;
      }
    }
  }
  return null;
}
// Raw output can contain credentials, private paths and URLs. Emit fixed enums
// and bounded known error codes only; no messages or arbitrary fields survive.
export function transportDiagnostics(input) {
  const text=String(input).slice(-1024*1024);
  const errors=structuredErrors(text);
  const codes=[],categories=[];
  if(errors) {
    for(const error of errors.slice(0,20)) {
      const code=error?.code;
      if(boundedCode(code) || (typeof code==='string' && (namedCodes.has(code) || /^ITMS-\d{5}$/.test(code))))codes.push(code);
      const message=typeof error?.message==='string'?error.message.slice(0,8192):'';
      categories.push(category(message)??'APPLE_VALIDATION');
    }
  } else {
    for(const line of text.split(/\r?\n/).filter(line=>/\bERROR:/.test(line)).slice(-20)) {
      const message=line.slice(0,8192);
      const match=message.match(/\bERROR:\s*\[(?:altool|ContentDelivery)[^\]\r\n]{1,100}\].*\((-?\d{1,6})\)\s*$/);
      if(match && boundedCode(Number(match[1])))codes.push(Number(match[1]));
      categories.push(category(message)??'UNCLASSIFIED_TRANSPORT_ERROR');
    }
    if(!categories.length)categories.push('UNSTRUCTURED_TRANSPORT_ERROR');
  }
  return {codes:[...new Set(codes)],categories:[...new Set(categories)]};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  let result;
  try {result=transportDiagnostics(readFileSync(process.argv[2],'utf8'));}
  catch {result={codes:[],categories:['DIAGNOSTICS_UNAVAILABLE']};}
  console.log('Allowlisted transport diagnostics: '+JSON.stringify(result));
}
