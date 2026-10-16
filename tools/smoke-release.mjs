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
for(const route of ['/','/library','/gift/'+giftProbe,'/gift-preview','/book-gift.mjs','/book-gift.css','/gift-compose.mjs','/gift-compose.css','/gift-identity.mjs','/gift-compose-state.mjs','/gift-preview.mjs','/gift-ritual.mjs','/brand-assets/envelope-edge.svg','/brand-assets/letter-edge.svg','/library-profile.mjs','/library-book-actions.mjs','/library-personal.css','/reading-schedule.mjs','/shelf-order.mjs','/read?book=gutenberg-alice','/portal.js','/library-workspace.css','/library-workspace.mjs','/reading-flow.mjs','/reading-load.mjs','/reading-arrival.mjs','/reading-arrival.css','/save-receipts.mjs']){
  const response=await get(route);const body=await response.text();if(!body.length)throw Error('Empty response: '+route);
  if((route==='/gift/'+giftProbe||route==='/gift-preview')&&!['src="/book-gift.mjs"','id="gift-open"','id="gift-error"'].every(marker=>body.includes(marker)))throw Error('Gift entry did not serve the gift letter page');
  if(route==='/gift-preview'&&!response.headers.get('content-security-policy')?.includes("frame-ancestors 'self'"))throw Error('Preview did not retain same-origin frame protection');
  if(/\.(?:mjs|js|css|svg)$/.test(route)&&response.headers.get('content-type')?.includes('text/html'))throw Error('Asset returned an HTML page: '+route);
}
// Verify the actual hosted static routes as well as the local HTTP contracts.
for(const route of ['/','/en','/en/mcp']){
  const response=await get(route),html=await response.text();
  if(response.headers.get('x-robots-tag')?.includes('noindex')||/<meta name="robots" content="noindex/.test(html))throw Error('Public discovery page is excluded: '+route);
  if(!html.includes('<link rel="canonical" href="https://leafhour.com'+route+'">')||!html.includes('application/ld+json'))throw Error('Missing discovery metadata: '+route);
  for(const [,json]of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g))JSON.parse(json);
}
const robots=await get('/robots.txt');if(!robots.headers.get('content-type')?.startsWith('text/plain')||!(await robots.text()).includes('Sitemap: https://leafhour.com/sitemap.xml'))throw Error('Missing public crawler discovery');
const sitemap=await get('/sitemap.xml'),xml=await sitemap.text();
if(!sitemap.headers.get('content-type')?.includes('xml')||!xml.includes('<loc>https://leafhour.com/en/mcp</loc>')||/<loc>[^<]*(?:\/library|\/read|\/api\/|\/gift|\?)/.test(xml))throw Error('Invalid public sitemap');
for(const route of ['/library?login=1','/read?book=gutenberg-alice','/gift-preview','/gift/'+giftProbe,'/evals','/api/auth/session']){
  const response=await get(route);if(!response.headers.get('x-robots-tag')?.includes('noindex'))throw Error('Missing private search exclusion: '+route);
}
const session=await(await get('/api/auth/session')).json();if(session.user)throw Error('Anonymous request received a user');
const library=await(await get('/api/library')).json();if(library.books?.length!==3||library.books.some(book=>book.visibility!=='public'))throw Error('Anonymous catalog is not the three public samples');
await get('/api/library/books/gutenberg-alice');
for(const route of ['/api/book','/api/records']){const response=await fetch(new URL(route,base),{signal:AbortSignal.timeout(15000)});if(response.status!==404)throw Error('Retired route is accessible: '+route);}
const gift=await fetch(new URL('/api/book-gifts/'+giftProbe,base),{signal:AbortSignal.timeout(15000)});if(gift.status!==404||!String((await gift.json()).error).includes('赠书信'))throw Error('Public gift endpoint did not reach its missing-letter response');
const profile=await fetch(new URL('/api/account/profile',base),{method:'POST',headers:{Origin:new URL(base).origin,'Content-Type':'application/json','X-Reader-Owner':'guest'},body:'{}',signal:AbortSignal.timeout(15000)});if(profile.status!==401)throw Error('Anonymous profile write did not fail with authentication required');
console.log('Production smoke passed: source, pages, assets, search discovery, private indexing exclusions, anonymous session, public catalog and gift/profile access boundaries.');
