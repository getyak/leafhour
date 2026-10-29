import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Raw transport output can contain private paths or credentials. Emit enums and codes only.
export function transportDiagnostics(text) {
  let parsed;
  try {parsed=JSON.parse(text);} catch {return {codes:[],categories:['UNSTRUCTURED_TRANSPORT_ERROR']};}
  const errors=Array.isArray(parsed['product-errors'])?parsed['product-errors']:Array.isArray(parsed.errors)?parsed.errors:[];
  const codes=[],categories=[];
  for(const error of errors.slice(0,20)) {
    const code=error?.code;
    if(Number.isSafeInteger(code) && Math.abs(code)<1000000)codes.push(code);
    else if(typeof code==='string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code))codes.push(code);
    const message=typeof error?.message==='string'?error.message.slice(0,8192):'';
    if(/(?:app.?icon|icon file|icon image|asset catalog)/i.test(message))categories.push('APP_ICON_VALIDATION');
    else if(/(?:authenticat|permission|unauthorized|forbidden)/i.test(message))categories.push('AUTHORIZATION');
    else if(/(?:network|timed? out|connection)/i.test(message))categories.push('TRANSPORT_NETWORK');
    else categories.push('APPLE_VALIDATION');
  }
  return {codes:[...new Set(codes)],categories:[...new Set(categories)]};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  let result;
  try {result=transportDiagnostics(readFileSync(process.argv[2],'utf8'));}
  catch {result={codes:[],categories:['DIAGNOSTICS_UNAVAILABLE']};}
  console.log('Allowlisted transport diagnostics: '+JSON.stringify(result));
}
