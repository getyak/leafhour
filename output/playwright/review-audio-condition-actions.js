async page => {
  const f=globalThis.reviewReaderFixture,out={fixture:true,checks:[],startWidth:page.viewportSize().width,measurements:[]};
  const check=(pass,label)=>{out.checks.push({label,pass:!!pass});if(!pass)throw Error(label);};
  const measure=async state=>{out.measurements.push({state,rows:await page.locator('#audio-dialog button,#audio-dialog summary,#audio-dialog select').evaluateAll(ns=>ns.filter(n=>n.getClientRects().length).map(n=>({name:n.getAttribute('aria-label')||n.textContent.trim().slice(0,40),w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})))});};
  const openSettings=async()=>{await page.locator('#exit-focus').click();await page.locator('#open-settings').click();};
  try{
    f.loadFail=false;f.recordsFail=false;f.records.position=null;await page.reload();await page.waitForFunction(()=>document.body.dataset.ready==='true');
    await page.waitForFunction(()=>document.querySelector('#settings-listening-summary').textContent.includes('隔离正文声音'));
    await openSettings();await page.locator('#view-mode').selectOption('zh');await page.keyboard.press('Escape');
    const passage=page.locator('[data-id="'+f.firstId+'"]');await passage.scrollIntoViewIfNeeded();await passage.focus();await passage.press('Enter');await page.locator('#show-audio').click();
    await page.getByRole('button',{name:'改听对应原文',exact:true}).waitFor({state:'visible'});check(true,'O08 missing translation offers corresponding source');await measure('missing translation');
    await page.getByRole('button',{name:'改听对应原文',exact:true}).click();await page.getByText('Isolated public text for listening UI.',{exact:true}).waitFor();check((await page.locator('#audio-dialog').innerText()).includes('原文朗读'),'O08 source retry reaches source preview');
    out.prepareFocus=await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id}));await page.keyboard.press('Escape');
    check(out.prepareFocus.tag!=='BODY','O08 completed source retry keeps dialog focus');
    await page.locator('#listen-chapter').scrollIntoViewIfNeeded();await page.locator('#listen-chapter').click();await page.getByRole('button',{name:/^双人讲解/}).click();
    out.scopeFocus=await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id}));
    check(out.scopeFocus.tag!=='BODY','O03 scope panel transition keeps dialog focus');
    const scope=page.getByRole('combobox',{name:'讲解范围',exact:true});const value=await scope.locator('option').nth(1).getAttribute('value');await scope.selectOption(value);check(await scope.inputValue()===value,'O09 actual section scope can be selected');await measure('dialogue scope');
    const generate=page.getByRole('button',{name:'生成双人讲稿',exact:true});await generate.click();await page.getByText('隔离讲稿暂时无法生成，请重试。',{exact:true}).waitFor();
    check(await generate.isEnabled()&&await scope.isEnabled(),'O10 failed isolated generation restores controls');out.generationFailureFocus=await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id}));
    check(out.generationFailureFocus.tag!=='BODY','O10 failed generation restores valid focus');
    await generate.focus();await page.keyboard.press('Enter');await page.getByRole('textbox',{name:'讲解者台词',exact:true}).waitFor({state:'visible'});check((await page.locator('#audio-dialog').innerText()).includes('AI 讲稿 · 已由你修改'),'O03 O10 retry shows attributed editable script');
    out.generatedFocus=await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id}));
    check(out.generatedFocus.tag==='TEXTAREA','O10 completed generation focuses editable script');
    await measure('generated latest script');
    await page.screenshot({path:'output/playwright/review-audio-script-'+out.startWidth+'-conditional.png',animations:'disabled'});await page.keyboard.press('Escape');
    await openSettings();await page.locator('#settings-tab-data').click();await page.locator('#settings-listening-records').click();await page.getByRole('button',{name:/正文朗读|双人讲解/}).first().click();
    await page.locator('#audio-player').waitFor({state:'visible'});await page.locator('#audio-expand').click();
    await page.waitForTimeout(850);await page.mouse.move(80,200);await page.mouse.wheel(0,260);await page.locator('#audio-return-follow').waitFor({state:'visible'});await page.locator('#audio-return-follow').focus();await page.keyboard.press('Enter');check(await page.locator('#audio-return-follow').isHidden(),'O41 explicit follow restores marker and hides action');
    out.followFocus=await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id}));
    check(out.followFocus.id==='audio-expand','O41 hidden follow action restores stable player focus');
    await page.locator('#audio-script').click();check((await page.locator('#audio-dialog').innerText()).includes('配音时的讲稿 · 第 1 版'),'O40 current player opens the audio snapshot revision');
    check(await page.getByRole('textbox',{name:'讲解者台词',exact:true}).evaluate(n=>n.readOnly),'O40 snapshot fields remain read-only');
    check((await page.getByRole('textbox',{name:'讲解者台词',exact:true}).inputValue()).includes('旧版配音快照'),'O40 snapshot does not silently use latest text');
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/playwright/review-audio-snapshot-390.png',animations:'disabled'});
    await page.getByRole('button',{name:'打开最新讲稿',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[aria-label="讲解者台词"]').readOnly);check(!await page.getByRole('textbox',{name:'讲解者台词',exact:true}).evaluate(n=>n.readOnly),'O15 latest script is editable');
    check((await page.getByRole('textbox',{name:'讲解者台词',exact:true}).inputValue()).includes('新版讲稿'),'O15 explicit latest action shows latest revision text');
    const controls=await page.locator('#audio-dialog button,#audio-dialog select').evaluateAll(ns=>ns.filter(n=>n.getClientRects().length).map(n=>({name:n.getAttribute('aria-label')||n.textContent.trim().slice(0,35),w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));
    out.mobileRects=controls;check(controls.every(r=>r.w>=44&&r.h>=44),'390 script controls have 44px targets');check(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),'390 audio conditional layout has no horizontal overflow');
    await page.screenshot({path:'output/playwright/review-audio-latest-390.png',animations:'disabled'});await page.keyboard.press('Escape');await page.locator('#audio-close').click();out.writeActions=f.writes.map(w=>w.action);
  }catch(error){out.failure=error.message;}
  return out;
}
