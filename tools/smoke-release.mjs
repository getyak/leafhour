const base=process.env.READER_URL||'https://reader.cubxxw.com',expected=process.env.EXPECTED_SOURCE_COMMIT;
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
for(const route of ['/','/library','/gift/'+giftProbe,'/book-gift.mjs','/book-gift.css','/library-profile.mjs','/library-book-actions.mjs','/library-personal.css','/reading-schedule.mjs','/shelf-order.mjs','/read?book=gutenberg-alice','/portal.js','/library-workspace.css','/library-workspace.mjs','/reading-flow.mjs','/reading-load.mjs','/reading-arrival.mjs','/reading-arrival.css','/save-receipts.mjs']){
  const response=await get(route);const body=await response.text();if(!body.length)throw Error('Empty response: '+route);
  if(route==='/gift/'+giftProbe&&!['src="/book-gift.mjs"','id="gift-open"','id="gift-error"'].every(marker=>body.includes(marker)))throw Error('Gift entry did not serve the gift letter page');
  if(/\.(?:mjs|js|css)$/.test(route)&&response.headers.get('content-type')?.includes('text/html'))throw Error('Asset returned an HTML page: '+route);
}
const session=await(await get('/api/auth/session')).json();if(session.user)throw Error('Anonymous request received a user');
const library=await(await get('/api/library')).json();if(library.books?.length!==3||library.books.some(book=>book.visibility!=='public'))throw Error('Anonymous catalog is not the three public samples');
await get('/api/library/books/gutenberg-alice');
for(const route of ['/api/book','/api/records']){const response=await fetch(new URL(route,base),{signal:AbortSignal.timeout(15000)});if(response.status!==404)throw Error('Retired route is accessible: '+route);}
const gift=await fetch(new URL('/api/book-gifts/'+giftProbe,base),{signal:AbortSignal.timeout(15000)});if(gift.status!==404||!String((await gift.json()).error).includes('赠书信'))throw Error('Public gift endpoint did not reach its missing-letter response');
const profile=await fetch(new URL('/api/account/profile',base),{method:'POST',headers:{Origin:new URL(base).origin,'Content-Type':'application/json','X-Reader-Owner':'guest'},body:'{}',signal:AbortSignal.timeout(15000)});if(profile.status!==401)throw Error('Anonymous profile write did not fail with authentication required');
console.log('Production smoke passed: source, pages, assets, anonymous session, public catalog and gift/profile access boundaries.');
