// Compare console errors against an unmodified, archived main checkout.
// Uses the same Playwright module and optional WebKit executable as the probe.
// node tools/capture-system-language-baseline.mjs <baseline-root> <artifact-dir> <baseline-sha>
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const [baselineRoot,artifactDirectory,source]=process.argv.slice(2);
assert.ok(baselineRoot&&artifactDirectory&&/^[a-f0-9]{40}$/.test(source||''));
assert.ok(process.env.LEAFHOUR_PLAYWRIGHT_MODULE);
const output=path.resolve(artifactDirectory);
const entries=execFileSync('git',['ls-tree','-rz',source],{encoding:'utf8'}).split('\0').filter(Boolean);
for(const entry of entries){
  const match=/^(\d+) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);assert.ok(match);
  const file=path.resolve(baselineRoot,match[3]);assert.ok(file.startsWith(path.resolve(baselineRoot)+path.sep));
  const bytes=await readFile(file),hash=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  assert.equal(hash,match[2],'Archived baseline differs from Git object: '+match[3]);
}
const {chromium,webkit}=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));
const {createReaderServer}=await import(pathToFileURL(path.resolve(baselineRoot,'server/server.mjs')));
const codes=new Map();
const server=await createReaderServer({
  bookPath:path.join(output,'absent.json'),recordsPath:path.join(output,'baseline-data/records.json'),
  portalDataDir:path.join(output,'baseline-data/portal'),allowLocal:false,
  sendCode:async(email,code)=>codes.set(email,code),env:{},generator:null,translator:null,
  speechProvider:null,dialogueGenerator:null,guideGenerator:null,chatGenerator:null,companionGenerator:null,
  introductionGenerator:null,giftQuoteGenerator:null,annotationGenerator:null,
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port,report={source,sourceVerification:{kind:'git-tree-blob-check',files:entries.length},engines:[]};
let browser;
try{
  for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
    browser=await engine.launch({headless:true,...(name==='webkit'&&process.env.LEAFHOUR_WEBKIT_EXECUTABLE?{executablePath:process.env.LEAFHOUR_WEBKIT_EXECUTABLE}:{})});
    const context=await browser.newContext({locale:'ja-JP'}),page=await context.newPage(),errors=[];
    page.on('console',message=>{
      if(message.type()==='error')errors.push({text:message.text(),path:message.location().url?new URL(message.location().url).pathname:null});
    });
    const email=name+'-baseline@example.test';
    assert.equal((await context.request.post(base+'/api/auth/code',{headers:{Origin:base},data:{email,purpose:'login'}})).status(),200);
    assert.equal((await context.request.post(base+'/api/auth/verify',{headers:{Origin:base},data:{email,purpose:'login',code:codes.get(email)}})).status(),200);
    await page.goto(base+'/library?settings=appearance');
    await page.locator('.ui-locale-choice').first().waitFor();
    // WebKit screenshots inject a stylesheet; reproduce this tool artifact too.
    for(let index=0;index<5;index++)await page.screenshot({caret:'initial',path:path.join(output,name+'-baseline-'+index+'.png')});
    await page.goto(base+'/billing');await page.locator('#billing-back').waitFor();await page.waitForTimeout(300);
    await page.goto(base+'/read?book=gutenberg-alice');await page.locator('#chapter-text .passage').nth(3).waitFor();
    await page.locator('#reading-tools-trigger').click();await page.locator('#open-settings').click();await page.waitForTimeout(300);
    await page.screenshot({caret:'initial',path:path.join(output,name+'-baseline-reader.png')});
    // The acceptance probe also opens Aa in a separate fallback context.
    const fallback=await browser.newContext({locale:'en-US'}),other=await fallback.newPage();
    other.on('console',message=>{if(message.type()==='error')errors.push({text:message.text(),path:message.location().url?new URL(message.location().url).pathname:null});});
    await other.goto(base+'/read?book=gutenberg-alice');await other.locator('#chapter-text .passage').nth(3).waitFor();
    await other.locator('#reading-tools-trigger').click();await other.locator('#open-settings').click();await other.waitForTimeout(300);await fallback.close();
    report.engines.push({engine:name,version:browser.version(),errors});
    await browser.close();browser=null;
  }
}finally{
  await browser?.close();await new Promise(resolve=>server.close(resolve));
  await writeFile(path.join(output,'baseline-console.json'),JSON.stringify(report,null,2)+'\n');
}
