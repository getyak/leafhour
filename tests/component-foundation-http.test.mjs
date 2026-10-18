import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';

const dir = await mkdtemp(path.join(tmpdir(), 'leafhour-components-http-'));
const server = await createReaderServer({bookPath: path.join(dir, 'missing-book.json'), recordsPath: path.join(dir, 'records.json'), allowLocal: false, env: {}, sendCode: null, translator: null, speechProvider: null, dialogueGenerator: null, guideGenerator: null, chatGenerator: null, companionGenerator: null, introductionGenerator: null, giftQuoteGenerator: null, paddleProvider: null});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
test.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dir, {recursive: true, force: true}); });

test('the shared interface module is served locally to every surface', async () => {
  const response = await fetch(base + '/interface-tokens.css');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/css/);
  const css = await response.text();
  for (const token of ['--line-hairline', '--line-control', '--shadow-popover', '--shadow-modal', '--focus-ring']) {
    assert.ok(css.includes(token), 'served module misses ' + token);
  }
  assert.doesNotMatch(css, /https?:\/\//, 'the module must not pull anything external');
  const appearance = await fetch(base + '/site-appearance.mjs');
  assert.equal(appearance.status, 200);
  assert.match(appearance.headers.get('content-type'), /^text\/javascript/);
});

test('home, library, reader, support and gift pages load the module right after typography', async () => {
  for (const route of ['/', '/zh-hans', '/library', '/read', '/en/privacy', '/ja/mcp', '/gift-preview']) {
    const html = await (await fetch(base + route)).text();
    assert.ok(html.includes('<link rel="stylesheet" href="/typography.css"><link rel="stylesheet" href="/interface-tokens.css">'),
      route + ' must load the shared interface module after typography');
  }
});

test('the technical tools load the shared module and keep their own type stack', async () => {
  for (const route of ['/source-review', '/evals']) {
    const html = await (await fetch(base + route)).text();
    assert.ok(html.includes('<link rel="stylesheet" href="/interface-tokens.css">'),
      route + ' must load the shared interface module');
    assert.match(await (await fetch(base + '/interface-tokens.css')).text(), /--focus-ring/);
  }
});

test('served dialog markup declares autofocus intent without tabindex', async () => {
  for (const route of ['/', '/read']) {
    const html = await (await fetch(base + route)).text();
    const dialogs = [...html.matchAll(/<dialog\b[^>]*>/g)].map(match => match[0]);
    assert.ok(dialogs.length >= 5, route + ' must keep its dialogs');
    for (const dialog of dialogs) assert.match(dialog, /^<dialog autofocus /, route + ' dialog missing autofocus: ' + dialog.slice(0, 50));
  }
});

test('the appearance compatibility key and localized labels survive the served module', async () => {
  const source = await (await fetch(base + '/site-appearance.mjs')).text();
  assert.ok(source.includes('marginalia-portal-appearance'), 'the stored compatibility key must stay');
  for (const label of ['页面外观', '頁面外觀', 'Appearance', '外観']) assert.ok(source.includes(label), 'missing localized appearance label ' + label);
  const html = await (await fetch(base + '/')).text();
  assert.ok(html.includes('id="site-theme"'), 'the homepage keeps its appearance trigger');
});
