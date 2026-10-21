import {readFile} from 'node:fs/promises';
const base=process.env.READER_URL||'https://leafhour.com',expected=process.env.EXPECTED_SOURCE_COMMIT;
const deadline=Date.now()+Number(process.env.RELEASE_WAIT_SECONDS||600)*1000;
async function get(route){const response=await fetch(new URL(route,base),{signal:AbortSignal.timeout(15000),headers:{'Cache-Control':'no-cache'}});if(!response.ok)throw Error(route+' returned '+response.status);return response;}
if(expected){
  if(!/^[a-f0-9]{40}$/.test(expected))throw Error('Expected a full source commit');
  while(true){
    try{const release=await(await get('/release.json?source='+expected)).json();if(release.sourceCommit===expected)break;}catch{}
    if(Date.now()>=deadline)throw Error('Production did not reach expected source '+expected);
    await new Promise(resolve=>setTimeout(resolve,15000));
  }
}
const giftProbe='A'.repeat(43);
for(const route of ['/reader-companion.mjs','/reader-companion-state.mjs','/reader-companion.css','/squirrel-motion.mjs','/squirrel-position.mjs','/book-reading-languages.mjs','/library-filter-controls.mjs','/library-filters.css','/reader-highlights.mjs','/passage-layers.mjs','/reader-navigation.mjs']){
  const response=await get(route);if(response.headers.get('content-type')?.includes('text/html')||!(await response.text()).length)throw Error('Missing companion asset: '+route);
}
const companion=await fetch(new URL('/api/library/books/gutenberg-alice/companion',base),{signal:AbortSignal.timeout(15000)});if(companion.status!==401)throw Error('Anonymous companion access did not require authentication');
const uiPreferences=await fetch(new URL('/api/account/ui-preferences',base),{signal:AbortSignal.timeout(15000),headers:{'Cache-Control':'no-cache'}});
if(uiPreferences.status!==401)throw Error('Anonymous UI preference access did not require authentication');
if(!uiPreferences.headers.get('cache-control')?.split(',').some(value=>value.trim().toLowerCase()==='no-store'))throw Error('UI preference response must not be cached');
for(const route of ['/','/library','/gift/'+giftProbe,'/gift-preview','/book-gift.mjs','/book-gift.css','/gift-compose.mjs','/gift-compose.css','/gift-identity.mjs','/gift-compose-state.mjs','/gift-preview.mjs','/gift-ritual.mjs','/brand-assets/envelope-edge.svg','/brand-assets/letter-edge.svg','/library-profile.mjs','/library-book-actions.mjs','/library-personal.css','/reading-schedule.mjs','/shelf-order.mjs','/read?book=gutenberg-alice','/portal.js','/library-workspace.css','/library-workspace.mjs','/reading-flow.mjs','/reading-load.mjs','/reading-arrival.mjs','/reading-arrival.css','/save-receipts.mjs']){
  const response=await get(route);const body=await response.text();if(!body.length)throw Error('Empty response: '+route);
  if((route==='/gift/'+giftProbe||route==='/gift-preview')&&!['src="/book-gift.mjs"','id="gift-open"','id="gift-error"'].every(marker=>body.includes(marker)))throw Error('Gift entry did not serve the gift letter page');
  if(route==='/gift-preview'&&!response.headers.get('content-security-policy')?.includes("frame-ancestors 'self'"))throw Error('Preview did not retain same-origin frame protection');
  if(/\.(?:mjs|js|css|svg)$/.test(route)&&response.headers.get('content-type')?.includes('text/html'))throw Error('Asset returned an HTML page: '+route);
}
// Verify the actual hosted static routes as well as the local HTTP contracts.
// English is the default language; /en and /en/mcp stay as aliases of the defaults.
const publicPages=[['/','https://leafhour.com/'],['/en','https://leafhour.com/'],['/zh-hans','https://leafhour.com/zh-hans'],['/zh-hant','https://leafhour.com/zh-hant'],['/ja','https://leafhour.com/ja'],['/mcp','https://leafhour.com/mcp'],['/en/mcp','https://leafhour.com/mcp'],['/zh-hans/mcp','https://leafhour.com/zh-hans/mcp'],['/zh-hant/mcp','https://leafhour.com/zh-hant/mcp'],['/ja/mcp','https://leafhour.com/ja/mcp'],['/privacy','https://leafhour.com/privacy'],['/zh-hans/privacy','https://leafhour.com/zh-hans/privacy'],['/zh-hant/privacy','https://leafhour.com/zh-hant/privacy'],['/ja/privacy','https://leafhour.com/ja/privacy']];
for(const [route,canonical] of publicPages){
  const response=await get(route),html=await response.text();
  if(response.headers.get('x-robots-tag')?.includes('noindex')||/<meta name="robots" content="noindex/.test(html))throw Error('Public discovery page is excluded: '+route);
  if(!html.includes('<link rel="canonical" href="'+canonical+'">')||!html.includes('application/ld+json'))throw Error('Missing discovery metadata: '+route);
  for(const [,json]of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g))JSON.parse(json);
}
const robots=await get('/robots.txt');if(!robots.headers.get('content-type')?.startsWith('text/plain')||!(await robots.text()).includes('Sitemap: https://leafhour.com/sitemap.xml'))throw Error('Missing public crawler discovery');
const sitemap=await get('/sitemap.xml'),xml=await sitemap.text();
if(!sitemap.headers.get('content-type')?.includes('xml')||!xml.includes('<loc>https://leafhour.com/ja/mcp</loc>')||!xml.includes('<loc>https://leafhour.com/zh-hant/privacy</loc>')||/<loc>[^<]*(?:\/library|\/read|\/api\/|\/gift|\?)/.test(xml))throw Error('Invalid public sitemap');
for(const route of ['/library?login=1','/read?book=gutenberg-alice','/gift-preview','/gift/'+giftProbe,'/evals','/api/auth/session']){
  const response=await get(route);if(!response.headers.get('x-robots-tag')?.includes('noindex'))throw Error('Missing private search exclusion: '+route);
}
const session=await(await get('/api/auth/session')).json();if(session.user)throw Error('Anonymous request received a user');
const library=await(await get('/api/library')).json();if(library.books?.length!==30||library.books.some(book=>book.visibility!=='public'))throw Error('Anonymous catalog is not the thirty shared English editions');
if(library.books.some(book=>book.sourceLanguage!=='en'||!Array.isArray(book.topics)||!book.topics.length))throw Error('Public catalog is missing original language or curated filter metadata');
if(library.books.some(book=>!Array.isArray(book.translationLanguages)||typeof book.supportsParallel!=='boolean'||!['none','partial','complete'].includes(book.translationCoverage)))throw Error('Public catalog is missing reading language metadata');
const catalog=JSON.parse(await readFile(new URL('../catalog/manifest.json',import.meta.url),'utf8'));
const readingMetadata=JSON.parse(await readFile(new URL('../catalog/reading-metadata.json',import.meta.url),'utf8'));
if(JSON.stringify(library.books.map(b=>b.bookId).sort())!==JSON.stringify(catalog.map(b=>b.id).sort()))throw Error('Production catalog IDs differ from the released manifest');
for(const entry of catalog){
 const book=await(await get('/api/library/books/'+entry.id)).json(),paragraphs=book.sections.flatMap(s=>s.paragraphs);
 if(book.visibility!=='public'||!paragraphs.some(p=>p.id===book.readingStart?.passageId))throw Error('Missing readable body: '+entry.id);
 if(book.source?.scopeNote!==entry.scopeNote||entry.translation!==undefined&&book.source.translation!==entry.translation)throw Error('Missing audited edition description: '+entry.id);
 const metadata=readingMetadata[entry.id];if(book.contentVersion!==metadata.contentVersion)throw Error('Changed audited edition: '+entry.id);
 const byId=new Map(paragraphs.map(p=>[p.id,p]));
 for(const [id,layout]of Object.entries(metadata.passages))for(const key of ['lineBreaks','labelBefore'])if(layout[key]!==undefined&&JSON.stringify(byId.get(id)?.source?.[key])!==JSON.stringify(layout[key]))throw Error('Missing audited source layout: '+entry.id+' / '+id);
 if(metadata.notices&&!book.licenseNotices?.includes(metadata.notices))throw Error('Missing source notices: '+entry.id);
 if(entry.format==='structured'){
  if(book.chapters.filter(c=>c.kind==='body').length!==entry.bodyChapters||!paragraphs.some(p=>p.original.includes(entry.opening))||!paragraphs.some(p=>p.original.includes(entry.ending)))throw Error('Truncated catalog edition: '+entry.id);
  if(paragraphs.some(p=>Object.keys(p.translations).length))throw Error('Unexpected published translation: '+entry.id);
 }
}
for(const route of ['/api/book','/api/records']){const response=await fetch(new URL(route,base),{signal:AbortSignal.timeout(15000)});if(response.status!==404)throw Error('Retired route is accessible: '+route);}
const gift=await fetch(new URL('/api/book-gifts/'+giftProbe,base),{signal:AbortSignal.timeout(15000)});if(gift.status!==404||!String((await gift.json()).error).includes('赠书信'))throw Error('Public gift endpoint did not reach its missing-letter response');
const profile=await fetch(new URL('/api/account/profile',base),{method:'POST',headers:{Origin:new URL(base).origin,'Content-Type':'application/json','X-Reader-Owner':'guest'},body:'{}',signal:AbortSignal.timeout(15000)});if(profile.status!==401)throw Error('Anonymous profile write did not fail with authentication required');
console.log('Production smoke passed: source, pages, assets, search discovery, private indexing exclusions, anonymous session, public catalog and gift/profile/UI preference access boundaries.');
