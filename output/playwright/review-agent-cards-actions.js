async page=>{
 const out={fixture:true,widths:[],externalDestinationsAreIntercepted:true};
 for(const width of [1440,390]){
  const row={width,checks:[],destinations:[]};out.widths.push(row);const check=(label,pass)=>row.checks.push({label,pass});
  await page.setViewportSize({width,height:width===390?844:1000});await page.goto('http://127.0.0.1:8337/read?book=gutenberg-alice');await page.locator('body[data-ready="true"]').waitFor();
  const open=async()=>{await page.locator('.library-chat-launcher').click();await page.locator('.library-chat-recommendation').first().waitFor();};await open();
  const tools=page.locator('.library-chat-answer .library-chat-activity-details').first();await tools.locator('summary').click();await tools.scrollIntoViewIfNeeded();
  row.cardRects=await page.locator('.library-chat-recommendation').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{text:e.textContent,width:r.width,height:r.height,href:e.getAttribute('href'),target:e.getAttribute('target'),rel:e.getAttribute('rel')};}));
  check('all3 recommendation types have actual44 targets',row.cardRects.length===3&&row.cardRects.every(e=>e.width>=44&&e.height>=44));
  await page.screenshot({path:'output/playwright/review-agent-current-'+width+'-tools-cards.png',animations:'disabled'});
  const owned=page.locator('.library-chat-recommendation').filter({hasText:'书房已有'});await owned.click();await page.locator('body[data-ready="true"]').waitFor();row.destinations.push(page.url());check('owned card pointer reaches the actual existing public book',new URL(page.url()).searchParams.get('book')==='gutenberg-alice');
  await open();const catalog=page.locator('.library-chat-recommendation').filter({hasText:'可直接阅读'});await catalog.focus();await page.keyboard.press('Enter');await page.waitForURL(u=>u.searchParams.get('book')==='gutenberg-walden');await page.locator('body[data-ready="true"]').waitFor();row.destinations.push(page.url());check('catalog card Enter reaches exact readable catalog book',new URL(page.url()).searchParams.get('book')==='gutenberg-walden');
  await page.goto('http://127.0.0.1:8337/read?book=gutenberg-alice');await page.locator('body[data-ready="true"]').waitFor();await open();const external=page.locator('.library-chat-recommendation').filter({hasText:'外部书目'});
  const popupPromise=page.waitForEvent('popup');await external.click();const popup=await popupPromise;await popup.waitForLoadState('domcontentloaded');row.destinations.push(popup.url());check('external card opens its safe isolated destination in a new tab',popup.url()==='https://example.com/marginalia-agent-review'&&new URL(page.url()).searchParams.get('book')==='gutenberg-alice');await popup.close();
  check('closing external destination keeps a valid visible card focus',await external.evaluate(e=>document.activeElement===e));
  await page.locator('.library-chat-close').click();
 }
 return out;
}
