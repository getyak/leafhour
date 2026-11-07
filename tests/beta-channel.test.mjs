import test from 'node:test';
import assert from 'node:assert/strict';

test('authored beta languages stay authoritative after the public shell starts',async()=>{
 const {classifyUiRoute}=await import('../app/ui-locale-codec.mjs');
 for(const [slug,locale]of [['en','en'],['zh-hans','zh-Hans'],['zh-hant','zh-Hant'],['ja','ja']]){
  const route=classifyUiRoute('/'+slug+'/beta');assert.equal(route.code,locale);
  assert.notEqual(route.kind,'canonical');
 }
 assert.equal(classifyUiRoute('/beta').code,'en');
});

test('only genuine public TestFlight destinations can become installation actions',async()=>{
 const {publicTestFlightUrl}=await import('../app/beta-channel.mjs');
 assert.equal(publicTestFlightUrl('https://testflight.apple.com/join/Ab12Cd34'),'https://testflight.apple.com/join/Ab12Cd34');
 for(const value of ['',null,'javascript:alert(1)','https://testflight.apple.com.evil.test/join/Ab12Cd34','https://name:secret@testflight.apple.com/join/Ab12Cd34','https://testflight.apple.com/join/Ab12Cd34?token=secret','https://testflight.apple.com/join/Ab12Cd34#fragment','https://appstoreconnect.apple.com/apps/123'])assert.equal(publicTestFlightUrl(value),null);
});

test('email drafts retain literal Unicode and line breaks without allowing injected headers',async()=>{
 const {composeBetaFeedback}=await import('../app/beta-channel.mjs');
 const result=composeBetaFeedback({locale:'zh-Hans',platform:'iOS',version:'17.5\r\nBcc: somebody@example.org',description:'选中“原文”后\n<script>alert(1)</script> & 下一页 📖'});
 assert.ok(result.mailto.startsWith('mailto:support@leafhour.com?subject='));
 const params=new URLSearchParams(result.mailto.split('?')[1]);
 assert.equal(params.get('subject'),'[Leafhour beta] iOS · 使用反馈');
 assert.equal(params.has('bcc'),false);assert.equal(params.has('cc'),false);
 assert.ok(params.get('body').includes('选中“原文”后\n<script>alert(1)</script> & 下一页 📖'));
 assert.ok(result.text.includes('support@leafhour.com'));
 assert.throws(()=>composeBetaFeedback({platform:'iOS',description:'  '}),/description/);
 assert.throws(()=>composeBetaFeedback({platform:'iOS\r\nBcc: a@b.com',description:'hello'}),/platform/);
});

test('missing installation eligibility stays unavailable while anonymous Web and email remain usable',async()=>{
 const {betaPage}=await import('../app/beta-page.mjs');
 for(const locale of ['en','zh-Hans','zh-Hant','ja']){
  const html=betaPage({locale,testflightUrl:null});
  assert.doesNotMatch(html,/<a[^>]*data-beta-install/);
  assert.match(html,/<button[^>]*disabled[^>]*data-beta-unavailable/);
  assert.ok(html.includes('href="/read?book=gutenberg-alice&amp;ui='+locale+'"'));
  assert.match(html,/mailto:support@leafhour\.com/);
  assert.doesNotMatch(html,/<input[^>]*type="email"/,'Direct installation has no signup form');
 }
 const available=betaPage({locale:'zh-Hans',testflightUrl:'https://testflight.apple.com/join/Ab12Cd34'});
 assert.match(available,/<a[^>]*data-beta-install[^>]*href="https:\/\/testflight\.apple\.com\/join\/Ab12Cd34"/);
 assert.doesNotMatch(available,/data-beta-unavailable/);
});
