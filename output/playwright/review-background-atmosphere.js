async page => {
  const f=globalThis.reviewReaderFixture,out={fixture:true,realStaticAudio:true,checks:[]};
  const check=(pass,label)=>{out.checks.push({label,pass:!!pass});if(!pass)throw Error(label);};
  let other;
  try{
    await page.addInitScript(()=>{const Native=window.AudioContext||window.webkitAudioContext;window.__reviewAudioContexts=[];if(Native)window.AudioContext=class extends Native{constructor(...args){super(...args);window.__reviewAudioContexts.push(this);}};});
    f.loadFail=false;f.recordsFail=false;await page.setViewportSize({width:390,height:844});await page.reload();await page.bringToFront();await page.waitForFunction(()=>document.body.dataset.ready==='true');
    const trigger=page.locator('#reading-tools-trigger');await trigger.focus();await trigger.press('Enter');await page.locator('#reading-tools-panel').waitFor({state:'visible'});await page.locator('#reading-toggle').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('#reading-state').textContent==='阅读中');
    await page.locator('#exit-focus').click();await page.locator('#open-atmosphere').click();await page.locator('.atmosphere-choice[data-scene=rain]').click();await page.waitForFunction(()=>document.querySelector('#atmosphere-dialog').dataset.playback==='playing');
    await page.locator('#atmosphere-music').fill('0');await page.locator('#atmosphere-nature').fill('0');await page.keyboard.press('Escape');
    out.foreground=await page.evaluate(()=>({hidden:document.hidden,active:document.documentElement.dataset.atmosphereActive,playback:document.querySelector('#atmosphere-dialog').dataset.playback,contexts:window.__reviewAudioContexts.map(c=>({state:c.state,time:c.currentTime})),reading:document.querySelector('#reading-state').textContent}));
    other=await page.context().newPage();await other.goto('about:blank');await other.bringToFront();await other.waitForTimeout(650);
    out.background=await page.evaluate(()=>({hidden:document.hidden,active:document.documentElement.dataset.atmosphereActive,playback:document.querySelector('#atmosphere-dialog').dataset.playback,contexts:window.__reviewAudioContexts.map(c=>({state:c.state,time:c.currentTime})),reading:document.querySelector('#reading-state').textContent}));
    check(out.background.hidden&&out.background.active==='false','actual background tab pauses visual atmosphere');
    check(out.background.playback==='playing'&&out.background.contexts[0].state==='running'&&out.background.contexts[0].time>out.foreground.contexts[0].time,'actual AudioContext continues in background');
    check(out.background.reading==='已暂停','actual background pauses reading clock');
    await page.bringToFront();await page.waitForFunction(()=>document.documentElement.dataset.atmosphereActive==='true');
    await page.locator('#exit-focus').click();await page.locator('#open-atmosphere').click();await page.locator('#atmosphere-play').click();check(await page.locator('#atmosphere-dialog').getAttribute('data-playback')==='paused','explicit sound pause stops session');await page.keyboard.press('Escape');
    await other.bringToFront();await other.waitForTimeout(200);await page.bringToFront();await page.waitForTimeout(200);check(await page.locator('#atmosphere-dialog').getAttribute('data-playback')==='paused','returning to tab does not restart manually paused sound');
    out.noRealWrites=true;
  }catch(error){out.failure=error.message;}
  finally{if(other)await other.close();}
  return out;
}
