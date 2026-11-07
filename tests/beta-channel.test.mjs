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

test('feedback uses one direct email action with no form or draft preparation in any locale',async()=>{
 const {betaPage}=await import('../app/beta-page.mjs');
 for(const locale of ['en','zh-Hans','zh-Hant','ja']){
  const html=betaPage({locale}),feedback=html.match(/<section class="beta-feedback"[\s\S]*?<\/section>/)?.[0];
  assert.ok(feedback);
  assert.doesNotMatch(feedback,/<form|<input|<select|<textarea|<button/);
  const actions=[...feedback.matchAll(/<a\b[^>]*href="([^"]+)"/g)];assert.equal(actions.length,1);
  assert.ok(actions[0][1].startsWith('mailto:support@leafhour.com'));
  assert.doesNotMatch(html,/src="\/beta-feedback\.mjs"/);
 }
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
