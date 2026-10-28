import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createUiLocale} from '../app/ui-locale.mjs';
import englishUi from '../app/ui-catalogs/en.mjs';
import japaneseUi from '../app/ui-catalogs/ja.mjs';
import {portalDocument} from '../server/portal-document.mjs';
import {createReaderServer} from '../server/server.mjs';
import {homeStringRows,homeAuthErrorRows,homeText,authErrorText,homeLocales,homeDocument} from '../app/home-locale.mjs';

const ids=html=>[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
const styles=html=>[...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(match=>match[1]);
const scripts=html=>[...html.matchAll(/<script type="module" src="([^"]+)"/g)].map(match=>match[1]);
const source=await readFile(new URL('../app/home.html',import.meta.url),'utf8');

test('every catalog row carries each public language beside its authored source',()=>{
  assert.deepEqual(homeLocales.map(row=>row.code),['en','zh-Hans','zh-Hant','ja']);
  assert.deepEqual(homeLocales.map(row=>row.route),['/','/zh-hans','/zh-hant','/ja']);
  for(const [rows,minimum] of [[homeStringRows,100],[homeAuthErrorRows,20]]){
    const seen=new Set();
    for(const row of rows){
      assert.equal(row.length,4,'catalog row must be [source, en, zh-Hant, ja]: '+row[0]);
      for(const value of row)assert.ok(typeof value==='string'&&value.length,'catalog row misses a language: '+row[0]);
      assert.ok(!seen.has(row[0]),'duplicate catalog key: '+row[0]);seen.add(row[0]);
    }
    assert.ok(rows.length>minimum);
  }
});

test('localization never rewrites book sample text and leaves no source text in the English page',()=>{
  const english=homeDocument(source,'en');
  const allowed=['“一本书如果没有图画，也没有对话，那有什么用呢？”爱丽丝想。','简体中文','繁體中文','日本語'];
  const stripped=allowed.reduce((text,value)=>text.replaceAll(value,''),english);
  assert.doesNotMatch(stripped,/\p{Script=Han}/u,'the English homepage leaked source-language text');
  const traditional=homeDocument(source,'zh-Hant'),japanese=homeDocument(source,'ja');
  assert.match(traditional,/可以匯入哪些格式？/);assert.match(traditional,/繁體中文/);
  assert.match(japanese,/本棚を開いています…/);
  assert.match(english,/What files can I import\?/);
  // Fragment rows bridge around inline links; edits must keep each language readable.
  assert.match(english,/are optional\. Unsynced records and drafts remain/);
  assert.match(traditional,/是否納入。未同步的記錄與草稿仍留在原瀏覽器/);
  assert.match(japanese,/任意です。未同期の記録と未保存の下書きは元のブラウザに残ります。処理方法は/);
  assert.doesNotMatch(japanese,/です まで|任意です まで/,'the Japanese FAQ kept a stale bridge across a removed link');
  const simplified='“一本书如果没有图画，也没有对话，那有什么用呢？”爱丽丝想。';
  const traditionalQuote='「一本書如果沒有圖畫，也沒有對話，那有什麼用呢？」愛麗絲想。';
  assert.ok(english.includes(simplified));
  assert.ok(japanese.includes(simplified));
  assert.ok(traditional.includes(traditionalQuote));
});

test('each public language renders the authored home structure and its own presentation',()=>{
  for(const locale of homeLocales){
    const html=homeDocument(source,locale.code);
    assert.deepEqual(ids(html),ids(source));assert.deepEqual(styles(html),styles(source));assert.deepEqual(scripts(html),scripts(source));
    assert.match(html,new RegExp('<html lang="'+locale.htmlLang+'">'));
    const canonical='https://leafhour.com'+locale.route;
    assert.match(html,new RegExp('<link rel="canonical" href="'+canonical.replace(/[/.]/g,'\\$&')+'">'));
    for(const other of homeLocales)assert.match(html,new RegExp('hreflang="'+other.htmlLang+'" href="https://leafhour\\.com'+other.route.replace(/\//g,'\\/')+'"'));
    assert.match(html,/hreflang="x-default" href="https:\/\/leafhour\.com\/">/);
    const graph=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
    const page=graph.find(node=>node['@type']==='WebPage');
    assert.equal(page.url,canonical);assert.equal(page.inLanguage,locale.htmlLang);
    assert.ok(graph.some(node=>node['@type']==='SoftwareApplication'&&node.name==='Leafhour'));
  }
});

test('the language switcher appears on the home page with the current language marked',()=>{
  for(const locale of homeLocales){
    const html=homeDocument(source,locale.code);
    const switchers=[...html.matchAll(/<(?:span|div) class="home-languages[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/g)];
    assert.equal(switchers.length,1,'language choices have one place in the compact menu');
    for(const [whole,inner]of switchers){
      assert.match(whole,/aria-label="/);
      for(const row of homeLocales)assert.match(inner,new RegExp('href="'+(row.code==='en'?'/en':row.route).replace(/\//g,'\\/')+'" lang="'+row.htmlLang+'"'));
      assert.equal((inner.match(/aria-current="true"/g)||[]).length,1);
      assert.match(inner,new RegExp('aria-current="true" href="'+(locale.code==='en'?'/en':locale.route).replace(/\//g,'\\/')+'"'));
    }
  }
});

test('dynamic sign-in counts and book labels localize per language',()=>{
  assert.equal(homeText('10 秒后重发','en'),'Resend in 10s');
  assert.equal(homeText('10 秒后重发','zh-Hant'),'10 秒後重發');
  assert.equal(homeText('10 秒后重发','ja'),'10秒後に再送信');
  assert.equal(homeText('双译开篇 · 12 段','ja'),'二つの訳 · 冒頭12段');
  assert.equal(homeText('自己的书 · PDF','en'),'A book of my own · PDF');
  assert.equal(homeText('共 3 段','en'),'共 3 passages');
  assert.equal(homeText('任意文本','zh-Hans'),'任意文本');
});

test('every static menu sheet control keeps explicit four-language authored copy',()=>{
  const menuLabels={
    'en':{open:'Open navigation menu',close:'Close menu',signIn:'Sign in / Sign up',search:'Search and commands',resume:'Continue reading',title:'Main navigation'},
    'zh-Hans':{open:'打开导航菜单',close:'关闭菜单',signIn:'登录 / 注册',search:'搜索与命令',resume:'继续阅读',title:'主导航'},
    'zh-Hant':{open:'開啟導覽選單',close:'關閉選單',signIn:'登入 / 註冊',search:'搜尋與命令',resume:'繼續閱讀',title:'主導覽'},
    'ja':{open:'ナビゲーションメニューを開く',close:'メニューを閉じる',signIn:'ログイン / 登録',search:'検索とコマンド',resume:'読み続ける',title:'メインナビゲーション'}
  };
  assert.deepEqual(Object.keys(menuLabels),homeLocales.map(row=>row.code),'the four authored languages each own the sheet copy');
  for(const locale of homeLocales){
    const html=homeDocument(source,locale.code),labels=menuLabels[locale.code];
    const trigger=(html.match(/<button[^>]*id="home-menu-trigger"[^>]*>/)||[])[0]||'';
    assert.ok(trigger.includes('aria-label="'+labels.open+'"'),locale.code+' menu trigger label');
    const close=(html.match(/<button[^>]*data-close="home-menu"[^>]*>/)||[])[0]||'';
    assert.ok(close.includes('aria-label="'+labels.close+'"'),locale.code+' menu close label');
    assert.doesNotMatch(html,/id="home-menu-(?:signin|account|search|resume)"/,locale.code+' menu excludes app-only controls');
    assert.ok(html.includes('<h2 id="home-menu-title" data-ui="nav.main">'+labels.title+'</h2>'),locale.code+' menu serif title');
  }
});

test('unknown sign-in service messages keep a readable localized fallback',()=>{
  assert.equal(authErrorText('请设置至少 8 个字符的密码','ja'),'8 文字以上のパスワードを設定してください。');
  assert.equal(authErrorText('未来的服务端消息','en'),'Unable to complete sign-in. Please try again or choose another sign-in method.');
  assert.equal(authErrorText('未来的服务端消息','ja'),'ログインを完了できませんでした。もう一度試すか、別のログイン方法をお選びください。');
  assert.equal(authErrorText('未来的服务端消息','zh-Hant'),'未来的服务端消息');
});

test('every language serves the same homepage structure over HTTP',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-home-locale-'));
  const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),sendCode:null,translator:null,chatGenerator:null});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const englishResponse=await fetch(base+'/'),english=await englishResponse.text();assert.equal(englishResponse.status,200);
  const showcaseStyle=await fetch(base+'/home-books.css');assert.equal(showcaseStyle.status,200);assert.match(showcaseStyle.headers.get('content-type'),/text\/css/);
  assert.match(english,/<html lang="en"(?:\s[^>]*)?>/);assert.doesNotMatch(english,/留一点时间，读进一本书。/);
  for(const locale of homeLocales){
    const route=locale.code==='en'?'/en':locale.route;
    const response=await fetch(base+route),html=await response.text();assert.equal(response.status,200);
    assert.deepEqual(ids(html),ids(english));assert.deepEqual(styles(html),styles(english));assert.deepEqual(scripts(html),scripts(english));
    assert.match(html,new RegExp('<html lang="'+locale.htmlLang+'">'));
    assert.ok(html.includes('id="account-button"'));assert.ok(html.includes('href="/read?book=gutenberg-alice&amp;ui='+locale.code+'"'));
    assert.doesNotMatch(html,/href="\/#how"/,'in-page navigation must stay on the current page');
    assert.doesNotMatch(html,/class="discovery-page"/);
    for(const guide of ['mcp','privacy']){
      const page=await fetch(base+(locale.route==='/'?'/'+guide:locale.route+'/'+guide)),text=await page.text();
      assert.equal(page.status,200);assert.match(text,new RegExp('<html lang="'+locale.htmlLang+'">'));
    }
  }
  const alias=await fetch(base+'/en');assert.equal(alias.status,200);assert.match(await alias.text(),/<link rel="canonical" href="https:\/\/leafhour.com\/">/);
  for(const asset of ['home-entry.mjs','home-entry-bootstrap.mjs']){
    const response=await fetch(base+'/'+asset);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);
    assert.equal(await response.text(),await readFile(new URL('../app/'+asset,import.meta.url),'utf8'),'the exact public module is served without an HTML fallback');
  }
});

test('the library shell renders the complete safe English shell and hides in-page home navigation',()=>{
  const library=portalDocument(source,'/library');
  assert.match(library,/<html lang="en"(?:\s[^>]*)?>/);assert.match(library,/<title>My reading room · Leafhour<\/title>/);
  assert.match(library,/Opening the reading room…/);
  assert.doesNotMatch(library,/class="home-nav" href=/);assert.equal(portalDocument(library,'/library'),library);
  assert.equal(portalDocument(source,'/unknown-route'),source);
});


test('first-paint owned home anchors carry the authored language even with denied storage and another browser language',async()=>{
 const denied={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};
 for(const code of ['en','zh-Hans','zh-Hant','ja']){
  const html=homeDocument(source,code),anchors=[...html.matchAll(/<a\b[^>]*\bhref="([^"\n]+)"/g)].map(m=>m[1].replaceAll('&amp;','&'));
  const owned=anchors.filter(href=>/^\/(?:library|read)(?:[?#]|$)/.test(href));
  assert.ok(owned.length>=3,'sample, excerpt and auth fallback links keep the authored language');
  for(const href of owned)assert.equal(new URL(href,'https://leafhour.com').searchParams.get('ui'),code,href);
 }
 const html=homeDocument(source,'en'),hero=/<a class="primary" href="([^"\n]+)"/.exec(html)?.[1];
 assert.ok(hero,'actual authored hero CTA exists');
 const runtime=createUiLocale({storage:denied,languages:['ja-JP'],getLocation:()=>({href:'https://leafhour.com'+hero.replaceAll('&amp;','&')}),loadCatalogue:async code=>({en:englishUi,ja:japaneseUi}[code])});
 await runtime.initialize();assert.equal(runtime.getUiLocale(),'en');
 const literal='<body><a href="/read?book=literal%2Fid&amp;passage=p1#source">Literal source</a><a href="https://other.test/read?book=x">External</a><a href="/api/export?signature=x">Export</a><a href="/read-more">Other</a></body>';
 const rendered=homeDocument(literal,'ja');
 assert.match(rendered,/href="\/read\?book=literal%2Fid&amp;passage=p1&amp;ui=ja#source"/);
 assert.match(rendered,/href="https:\/\/other.test\/read\?book=x"/);assert.match(rendered,/href="\/api\/export\?signature=x"/);assert.match(rendered,/href="\/read-more"/);
});


test('public home navigation exposes localized Agent and pricing links plus a named GitHub mark before JavaScript',async()=>{
 const source=await readFile(new URL('../app/home.html',import.meta.url),'utf8');
 for(const locale of homeLocales){
  const html=homeDocument(source,locale.code),header=html.match(/<header class="site-header"[\s\S]*?<\/header>/)[0];
  const slug=locale.code==='en'?'en':locale.route.slice(1);
  assert.ok(header.includes('href="'+(locale.code==='en'?'/mcp':'/'+slug+'/mcp')+'"'));
  assert.ok(header.includes('href="/'+slug+'/pricing"'));
  assert.match(header,/<a[^>]*aria-label="GitHub"[^>]*>[\s\S]*?<svg/);
  assert.match(header,/https:\/\/github.com\/getyak\/leafhour/);
 }
});
