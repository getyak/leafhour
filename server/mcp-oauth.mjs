import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';

const opaque=()=>randomBytes(32).toString('base64url');
const hash=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const failure=(oauthError='invalid_request',status=400)=>Object.assign(Error('Reconnect Leafhour and approve access to one book.'),{status,oauthError});
const field=(v,max=2048)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const parameters=(params,allowed)=>{const out={};for(const [key,value]of params){if(!allowed.includes(key)||Object.hasOwn(out,key)||!field(value))throw failure();out[key]=value;}return out;};
const empty=()=>({clients:[],requests:[],codes:[],tokens:[]});

// This authorization server reuses the site's authenticated browser sessions
// and the domain's per-book grants. No provider tokens or browser cookies are
// handed to MCP clients; only hashes of our own credentials are persisted.
export function createMcpOAuth({origin,store,library,clock=Date.now}){
 const base=new URL(origin);if(base.protocol!=='https:'||base.origin!==origin)throw Error('MCP OAuth requires a configured HTTPS origin.');
 const resource=origin+'/api/mcp',stateKey='mcp/oauth-v1';
 const mutate=fn=>store.mutate(stateKey,empty(),data=>{for(const key of ['requests','codes','tokens'])data[key]=data[key].filter(row=>row.expiresAt>clock());return fn(data);});
 async function rate(key,limit){
  const now=clock(),bucket=Math.floor(now/60000),id=hash(key);
  const allowed=await store.mutate('mcp/rate-v1',{bucket,counts:{}},data=>{if(data.bucket!==bucket){data.bucket=bucket;data.counts={};}const total=data.counts.all||0;if(total>=2000)return false;if(!Object.hasOwn(data.counts,id)&&Object.keys(data.counts).length>=1001)return false;data.counts.all=total+1;data.counts[id]=(data.counts[id]||0)+1;return data.counts[id]<=limit;});
  if(!allowed)throw Object.assign(failure('temporarily_unavailable',429),{retryAfter:60-Math.floor(now/1000)%60});
 }
 function resourceMetadata(){return {resource,authorization_servers:[origin],scopes_supported:['content'],bearer_methods_supported:['header'],resource_name:'Leafhour reading'};}
 function serverMetadata(){return {issuer:origin,authorization_endpoint:origin+'/api/mcp/oauth/authorize',token_endpoint:origin+'/api/mcp/oauth/token',registration_endpoint:origin+'/api/mcp/oauth/register',revocation_endpoint:origin+'/api/mcp/oauth/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code'],token_endpoint_auth_methods_supported:['none'],revocation_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:['content'],authorization_response_iss_parameter_supported:true};}
 async function register(input){
  await rate('registration',10);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['client_name','redirect_uris','token_endpoint_auth_method','grant_types','response_types','scope','client_uri','logo_uri'].includes(k)))throw failure('invalid_client_metadata');
  if(!Array.isArray(input.redirect_uris)||input.redirect_uris.length<1||input.redirect_uris.length>5||input.redirect_uris.some(uri=>{try{const u=new URL(uri);return !field(uri)||u.protocol!=='https:'||u.username||u.password||u.hash||u.href!==uri;}catch{return true;}}))throw failure('invalid_redirect_uri');
  if(input.token_endpoint_auth_method!==undefined&&input.token_endpoint_auth_method!=='none'||input.grant_types!==undefined&&JSON.stringify(input.grant_types)!=='["authorization_code"]'||input.response_types!==undefined&&JSON.stringify(input.response_types)!=='["code"]'||input.scope!==undefined&&input.scope!=='content'||input.client_name!==undefined&&!field(input.client_name,120))throw failure('invalid_client_metadata');
  const client={client_id:opaque(),client_name:input.client_name||'MCP client',redirect_uris:[...new Set(input.redirect_uris)],token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code'],scope:'content'};
  await mutate(data=>{if(data.clients.length>=1000)throw failure('temporarily_unavailable',503);data.clients.push(client);});return client;
 }
 async function begin(params){
  await rate('authorization',60);
  const p=parameters(params,['client_id','redirect_uri','response_type','scope','resource','state','code_challenge','code_challenge_method']);
  const data=await store.read(stateKey,empty()),client=data.clients.find(c=>c.client_id===p.client_id);
  if(!client||!client.redirect_uris.includes(p.redirect_uri))throw failure('invalid_client');
  if(p.response_type!=='code'||p.resource!==resource||p.scope!==undefined&&p.scope!=='content'||p.code_challenge_method!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge||'')||p.state!==undefined&&!field(p.state,1024))throw failure();
  const request=opaque();await mutate(data=>{if(data.requests.length>=500)throw failure('temporarily_unavailable',503);data.requests.push({...p,id:hash(request),expiresAt:clock()+600000});});return request;
 }
 async function consent(request,user,session){
  if(!user?.id||!field(session,4096)||!/^[A-Za-z0-9_-]{43}$/.test(request||''))throw failure('access_denied',401);
  const csrf=opaque();return mutate(data=>{const row=data.requests.find(r=>r.id===hash(request));if(!row||row.ownerId&&row.ownerId!==user.id||row.sessionHash&&row.sessionHash!==hash(session))throw failure('access_denied',403);row.ownerId=user.id;row.sessionHash=hash(session);row.csrfHash=hash(csrf);const client=data.clients.find(c=>c.client_id===row.client_id);return {csrf,clientName:client.client_name,redirectUri:row.redirect_uri};});
 }
 async function approve(input,user,session){
  if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['request','csrf','bookId','allow'].includes(k))||!user?.id||!field(session,4096)||!field(input.request,43)||!field(input.csrf,43)||typeof input.allow!=='boolean')throw failure('access_denied',403);
  // Verify browser binding before the book lookup, then atomically consume the
  // request. Store CAS callbacks contain no external writes or model calls.
  const check=row=>row&&row.expiresAt>clock()&&row.ownerId===user.id&&row.sessionHash===hash(session)&&same(row.csrfHash,hash(input.csrf));
  const before=(await store.read(stateKey,empty())).requests.find(r=>r.id===hash(input.request));if(!check(before))throw failure('access_denied',403);
  if(input.allow)await library.getBook(user,input.bookId);
  const code=opaque(),redirect=await mutate(data=>{const row=data.requests.find(r=>r.id===hash(input.request));if(!check(row))throw failure('access_denied',403);data.requests=data.requests.filter(r=>r!==row);if(input.allow){if(data.codes.length>=500)throw failure('temporarily_unavailable',503);data.codes.push({...row,id:hash(code),bookId:input.bookId,expiresAt:clock()+120000});}return row;});
  const url=new URL(redirect.redirect_uri);url.searchParams.set('iss',origin);if(redirect.state)url.searchParams.set('state',redirect.state);url.searchParams.set(input.allow?'code':'error',input.allow?code:'access_denied');return url.href;
 }
 async function exchange(params){
  await rate('exchange',120);
  const p=parameters(params,['grant_type','client_id','redirect_uri','resource','code','code_verifier']);
  if(p.grant_type!=='authorization_code'||p.resource!==resource||!/^[A-Za-z0-9_-]{43}$/.test(p.code||'')||!/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_verifier||''))throw failure('invalid_grant');
  const challenge=createHash('sha256').update(p.code_verifier).digest('base64url');
  const row=await mutate(data=>{const row=data.codes.find(r=>r.id===hash(p.code));if(!row||row.client_id!==p.client_id||row.redirect_uri!==p.redirect_uri||row.resource!==p.resource||!same(row.code_challenge,challenge))throw failure('invalid_grant');data.codes=data.codes.filter(r=>r!==row);return row;});
  // A storage failure after consumption requires reauthorization, never a
  // blind token-exchange retry. Credentials are returned only once.
  const grant=await library.createMcpGrant({id:row.ownerId},row.bookId),expiresAt=Math.min(Date.parse(grant.expiresAt),clock()+3600000);
  await mutate(data=>{if(data.tokens.length>=1000)throw failure('temporarily_unavailable',503);data.tokens.push({id:hash(grant.token),grantId:grant.id,ownerId:row.ownerId,bookId:row.bookId,clientId:row.client_id,resource,scope:'content',expiresAt});});
  return {access_token:grant.token,token_type:'Bearer',scope:'content',resource,expires_in:Math.max(0,Math.floor((expiresAt-clock())/1000))};
 }
 async function authenticate(token){
  if(!field(token,128))throw failure('invalid_token',401);
  const row=(await store.read(stateKey,empty())).tokens.find(r=>same(r.id,hash(token)));
  if(!row||row.expiresAt<=clock()||row.resource!==resource||row.scope!=='content')throw failure('invalid_token',401);
  let user;try{user=await library.authorize(token,row.bookId,'content');}catch(e){if(e.status>=500)throw e;throw failure('invalid_token',401);}
  if(user.id!==row.ownerId)throw failure('invalid_token',401);return row;
 }
 async function revoke(params){const p=parameters(params,['token','token_type_hint','client_id']);if(!field(p.token,128)||!field(p.client_id,128))throw failure();await rate('revocation',120);const row=(await store.read(stateKey,empty())).tokens.find(r=>r.id===hash(p.token)&&r.clientId===p.client_id);if(row){await library.revokeGrant({id:row.ownerId},row.grantId);await mutate(data=>{data.tokens=data.tokens.filter(r=>r.id!==row.id);});}}
 return {resourceMetadata,serverMetadata,register,begin,consent,approve,exchange,authenticate,revoke,rate};
}
