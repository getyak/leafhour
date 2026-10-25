// Explicit user generation only. Reading, automatic companion work, cancellation
// and settings never pass this gate. Browser consent is presentation; the server
// remains the authority for identity, quote scope, balance and settlement.
const PRICES={translation:1000000,conversation:4000000,annotation:4000000};
const fields={translation:['id','passageId','contentVersion'],conversation:['id','text','passageId','contentVersion','scopeRevision','quote','preferenceWrites'],annotation:['id','threadId','quote','highlightId','text','responseLocale']};
const languages={
 en:{point:n=>n===1?'1 point':`${n} points`,names:{translation:'Dual translation',conversation:'Reading question',annotation:'AI annotation'},consent:(name,price)=>`${name} uses ${price}.\n\nA single-passage dual translation costs 1 point; a reading question or AI annotation costs 4 points. Points are reserved during processing and consumed only after a valid result is saved. Failed, cancelled or undelivered work does not consume purchased points. Saved results, reading, notes and export remain free. Automatic companion messages never use purchased points. Future action buttons show their point price.\n\nUse reading points for this request?`,test:'Test mode: these are sandbox points, not a real payment.\n\n',changed:'Your account changed. Reopen your reading room before using points.',cancelled:'Point use was cancelled. Nothing was submitted.',funds:'Not enough reading points for this request. Open Points & billing or keep reading.',signin:'Sign in before using reading points.',unavailable:'Paid AI is unavailable. You can keep reading and export your records.',invalid:'This quote changed or could not be verified. Refresh before trying again.'},
 'zh-Hans':{point:n=>`${n} 点`,names:{translation:'单段双译',conversation:'阅读对话',annotation:'AI 注解'},consent:(name,price)=>`${name}使用 ${price}。\n\n单段双译 1 点，一次阅读对话或 AI 注解 4 点。处理中先预留，结果校验并保存后才消费。失败、取消或未交付不消费购买点。已有结果、阅读、笔记与导出免费。自动松鼠陪读绝不使用购买点。后续操作按钮会显示点数。\n\n确认本次使用阅读点？`,test:'测试模式：仅使用沙盒点数，不涉及真实付款。\n\n',changed:'账户已变化，请重新进入自己的书房后使用点数。',cancelled:'已取消使用阅读点，本次尚未提交。',funds:'本次阅读点不足。可以打开“额度与账单”，也可以继续阅读。',signin:'请先登录再使用阅读点。',unavailable:'收费 AI 暂不可用，阅读与导出仍可使用。',invalid:'报价已变化或无法核验，请刷新后重试。'},
 'zh-Hant':{point:n=>`${n} 點`,names:{translation:'單段雙譯',conversation:'閱讀對話',annotation:'AI 註解'},consent:(name,price)=>`${name}使用 ${price}。\n\n單段雙譯 1 點，一次閱讀對話或 AI 註解 4 點。處理中先預留，結果校驗並儲存後才消費。失敗、取消或未交付不消費購買點。已有結果、閱讀、筆記與匯出免費。自動松鼠陪讀絕不使用購買點。後續操作按鈕會顯示點數。\n\n確認本次使用閱讀點？`,test:'測試模式：僅使用沙盒點數，不涉及真實付款。\n\n',changed:'帳戶已變更，請重新進入自己的書房後使用點數。',cancelled:'已取消使用閱讀點，本次尚未提交。',funds:'本次閱讀點不足。可以開啟「額度與帳單」，也可以繼續閱讀。',signin:'請先登入再使用閱讀點。',unavailable:'收費 AI 暫不可用，閱讀與匯出仍可使用。',invalid:'報價已變更或無法核驗，請重新整理後重試。'},
 ja:{point:n=>`${n} ポイント`,names:{translation:'直訳と意訳',conversation:'読書対話',annotation:'AI 注釈'},consent:(name,price)=>`${name}は ${price} を使用します。\n\n1 段落の直訳と意訳は 1 ポイント、1 回の読書対話または AI 注釈は 4 ポイントです。処理中に確保し、検証済み結果の保存後に消費します。失敗、キャンセル、未提供の処理には購入ポイントを消費しません。保存済み結果、読書、ノート、エクスポートは無料です。自動コンパニオンは購入ポイントを使いません。今後の操作ボタンにも価格を表示します。\n\nこの依頼に読書ポイントを使いますか？`,test:'テストモード：サンドボックスポイントのみで、実際の支払いはありません。\n\n',changed:'アカウントが変わりました。読書室を開き直してください。',cancelled:'ポイント利用をキャンセルしました。依頼は送信していません。',funds:'ポイントが不足しています。「ポイントと請求」を開くか、そのまま読書を続けられます。',signin:'ポイントを使うにはログインしてください。',unavailable:'有料 AI は現在利用できません。読書とエクスポートは利用できます。',invalid:'見積もりが変更されたか確認できません。更新して再試行してください。'}
};
const localeCode=locale=>Object.hasOwn(languages,locale)?locale:'en';
const labels=locale=>languages[localeCode(locale)];
const fail=(code,status,locale)=>Object.assign(new Error(creditErrorMessage({code,status},locale)),{code,status,preSubmit:true,billingUrl:'/billing?ui='+localeCode(locale)});
export {creditActionLabel} from './credit-labels.mjs';
const preferenceSummary={en:['Preference updates are off.','Preference updates are allowed.'],'zh-Hans':['不可修改阅读偏好。','允许修改阅读偏好。'],'zh-Hant':['不可修改閱讀偏好。','允許修改閱讀偏好。'],ja:['設定は変更できません。','設定の変更を許可。']};
export function creditConsentText({action,units,locale='en',mode='live',preferenceWrites=false}={}){const c=labels(locale);return (mode==='test'?c.test:'')+c.consent(c.names[action]||'',c.point(units/1000000))+(action==='conversation'?'\n\n'+preferenceSummary[localeCode(locale)][preferenceWrites===true?1:0]:'');}
export function creditErrorMessage(error,locale='en'){
 const c=labels(locale);return error?.code==='BILLING_ACCOUNT_CHANGED'?c.changed:error?.code==='BILLING_CONSENT_CANCELLED'?c.cancelled:error?.status===402?c.funds:error?.status===401?c.signin:error?.code==='BILLING_INVALID_QUOTE'||error?.code==='BILLING_INVALID_INPUT'||error?.code==='BILLING_INPUT_CHANGED'?c.invalid:c.unavailable;
}
const ownerId=value=>typeof value==='string'?value:typeof value?.owner==='string'?value.owner:null;
function actionRoute(url){
 if(typeof url!=='string'||!url.startsWith('/')||url.startsWith('//'))return null;
 let pathname;try{pathname=new URL(url,'https://leafhour.invalid').pathname;}catch{return null;}
 const match=pathname.match(/^\/api\/library\/books\/([^/]+)\/(translate|chat|annotations\/explain)$/);if(!match)return null;
 let bookId;try{bookId=decodeURIComponent(match[1]);}catch{return null;}
 if(!bookId||bookId.length>256||/[\x00-\x1f/?#\\]/.test(bookId))return null;
 return {bookId,action:({translate:'translation',chat:'conversation','annotations/explain':'annotation'})[match[2]]};
}
const fallbackConsent=new Set(),fallbackPairs=new Map(),requestIds=new WeakMap();
const newId=()=>{if(typeof globalThis.crypto?.randomUUID!=='function')throw Error('Secure request identifiers unavailable');return globalThis.crypto.randomUUID();};
const defaultStorage=()=>{try{return globalThis.sessionStorage;}catch{return null;}};
const hasConsent=(storage,key)=>{try{return storage?storage.getItem(key)==='confirmed':fallbackConsent.has(key);}catch{return false;}};
const saveConsent=(storage,key)=>{try{if(storage)storage.setItem(key,'confirmed');else fallbackConsent.add(key);}catch{/* Unavailable storage means confirming again next time. */}};
const originalStillMatches=(data,serialized)=>{try{return JSON.stringify(data)===serialized;}catch{return false;}};
async function prepare({url,data,session,owner,isCurrent=()=>true,fetcher=globalThis.fetch?.bind(globalThis),confirm=globalThis.confirm?.bind(globalThis),locale='en',storage=defaultStorage()}={}){
 // Preserve disabled instances exactly, including payload identity and missing IDs.
 if(session?.billing?.enabled!==true)return data;
 const route=actionRoute(url);if(!route)return data;
 const {action,bookId}=route,capturedOwner=ownerId(owner)||session?.user?.id,mode=session.billing.mode;
 if(!capturedOwner||capturedOwner==='guest'||session?.user?.id!==capturedOwner)throw fail('BILLING_SIGN_IN_REQUIRED',401,locale);
 const current=()=>isCurrent()&&session?.user?.id===capturedOwner;
 if(!current())throw fail('BILLING_ACCOUNT_CHANGED',409,locale);
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(key=>!fields[action].includes(key)))throw fail('BILLING_INVALID_INPUT',400,locale);
 if(action==='conversation'&&data.preferenceWrites!==undefined&&typeof data.preferenceWrites!=='boolean')throw fail('BILLING_INVALID_INPUT',400,locale);
 const units=session.billing.prices?.[action];
 if(session.billing.unitsPerPoint!==1000000||units!==PRICES[action]||!['live','test'].includes(mode))throw fail('BILLING_INVALID_QUOTE',409,locale);
 let original;try{original=JSON.stringify(data);}catch{throw fail('BILLING_INVALID_INPUT',400,locale);}
 // Clone nested source quotes so UI edits during consent cannot alter the body
 // that the server quoted. The caller retains its own drafts unchanged.
 const body=JSON.parse(original);
 if(body.id==null&&action==='translation'){let id=requestIds.get(data);if(!id){id=newId();requestIds.set(data,id);}body.id=id;}
 if(typeof body.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(body.id))throw fail('BILLING_INVALID_INPUT',400,locale);
 const unchanged=()=>current()&&originalStillMatches(data,original);
 async function request(path,body){
  if(!unchanged())throw fail('BILLING_ACCOUNT_CHANGED',409,locale);
  let response,result;try{response=await fetcher(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json','X-Reader-Owner':capturedOwner,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});result=await response.json();}catch(error){if(error?.code?.startsWith('BILLING_'))throw error;throw fail('BILLING_UNAVAILABLE',503,locale);}
  if(!unchanged())throw fail('BILLING_ACCOUNT_CHANGED',409,locale);
  if(!response.ok)throw fail(response.status===402?'BILLING_INSUFFICIENT_POINTS':response.status===401?'BILLING_SIGN_IN_REQUIRED':'BILLING_UNAVAILABLE',response.status,locale);
  return result;
 }
 async function verifyIdentity(){const next=await request('/api/auth/session');if(next?.user?.id!==capturedOwner||!unchanged())throw fail('BILLING_ACCOUNT_CHANGED',409,locale);}
 // Only the input digest and minimal quote references are persisted. Reading
 // text, questions and source selections never enter sessionStorage here.
 const stable=value=>value===null||typeof value!=='object'?value:Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
 const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(body))));
 const fingerprint=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
 const pairKey='marginalia-credit-request:v1:owner='+encodeURIComponent(capturedOwner)+':'+encodeURIComponent(JSON.stringify([mode,action,bookId,body.id]));
 let cached=null;
 try{const value=storage?storage.getItem(pairKey):fallbackPairs.get(pairKey);if(value)cached=JSON.parse(value);}catch{throw fail('BILLING_STORAGE_UNAVAILABLE',503,locale);}
 if(cached&&(cached.ownerId!==capturedOwner||cached.mode!==mode||cached.action!==action||cached.bookId!==bookId||cached.requestId!==body.id||cached.fingerprint!==fingerprint))throw fail('BILLING_INPUT_CHANGED',409,locale);
 await verifyIdentity();
 const quote=cached?cached.quote:await request('/api/billing/quotes',{action,bookId,input:body});
 if(!quote||typeof quote.id!=='string'||!quote.id||quote.id.length>200||quote.units!==units||quote.ownerId!==capturedOwner||quote.action!==action||(quote.mode!==undefined&&quote.mode!==mode)||quote.scope?.bookId!==bookId||quote.scope?.requestId!==body.id||(body.passageId&&quote.scope.passageId!==undefined&&quote.scope.passageId!==body.passageId)||(body.contentVersion&&quote.scope.contentVersion!==undefined&&quote.scope.contentVersion!==body.contentVersion)||(!cached&&quote.expiresAt&&(!Number.isFinite(Date.parse(quote.expiresAt))||Date.parse(quote.expiresAt)<=Date.now()))||(cached&&(typeof cached.idempotencyKey!=='string'||!cached.idempotencyKey||cached.idempotencyKey.length>200)))throw fail('BILLING_INVALID_QUOTE',409,locale);
 await verifyIdentity();
 const schedule=JSON.stringify([mode,session.billing.priceVersion||'',session.billing.unitsPerPoint,...Object.keys(PRICES).map(key=>session.billing.prices[key]),...(action==='conversation'?[body.preferenceWrites===true]:[])]);
 const consentKey='marginalia-credit-consent:v1:'+encodeURIComponent(capturedOwner)+':'+schedule;
 let newlyConsented=false;
 if(!hasConsent(storage,consentKey)){
  if(typeof confirm!=='function'||!await confirm(creditConsentText({action,units,locale,mode,preferenceWrites:body.preferenceWrites===true})))throw fail('BILLING_CONSENT_CANCELLED',409,locale);
  if(!unchanged())throw fail('BILLING_ACCOUNT_CHANGED',409,locale);
  await verifyIdentity();newlyConsented=true;
 }
 if(!unchanged())throw fail('BILLING_ACCOUNT_CHANGED',409,locale);
 const idempotencyKey=cached?cached.idempotencyKey:newId();
 if(!cached){
  const cleanScope=Object.fromEntries(['bookId','requestId','passageId','contentVersion'].filter(key=>quote.scope[key]!==undefined).map(key=>[key,quote.scope[key]]));
  const cleanQuote=Object.fromEntries(['id','ownerId','mode','action','units','priceVersion','expiresAt'].filter(key=>quote[key]!==undefined).map(key=>[key,quote[key]]));
  const pair={ownerId:capturedOwner,mode,action,bookId,requestId:body.id,fingerprint,quote:{...cleanQuote,scope:cleanScope},idempotencyKey};
  try{const value=JSON.stringify(pair);if(storage)storage.setItem(pairKey,value);else{fallbackPairs.set(pairKey,value);if(fallbackPairs.size>256)fallbackPairs.delete(fallbackPairs.keys().next().value);}}catch{throw fail('BILLING_STORAGE_UNAVAILABLE',503,locale);}
 }
 if(newlyConsented)saveConsent(storage,consentKey);
 // A retry reuses even an expired original quote: the ledger first resolves
 // its existing reservation. If no reservation exists, the server rejects the
 // stale quote; only a new explicit request ID starts a new paid attempt.
 return {...body,billing:{quoteId:quote.id,idempotencyKey}};
}

export async function prepareCreditRequest(options={}){
 try{return await prepare(options);}catch(error){
  if(error&&typeof error==='object'){error.preSubmit=true;error.code||='BILLING_UNAVAILABLE';error.status||=503;}
  throw error;
 }
}
