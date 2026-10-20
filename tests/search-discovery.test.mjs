import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';

async function fixture(t){
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-discovery-'));
  const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),translator:null,sendCode:null,chatGenerator:null});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  return 'http://127.0.0.1:'+server.address().port;
}
const schemas=html=>[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap(match=>JSON.parse(match[1])['@graph']||[JSON.parse(match[1])]);
const pages={
  '/':{lang:'en',canonical:'https://leafhour.com/'},
  '/zh-hans':{lang:'zh-Hans',canonical:'https://leafhour.com/zh-hans'},
  '/zh-hant':{lang:'zh-Hant',canonical:'https://leafhour.com/zh-hant'},
  '/ja':{lang:'ja',canonical:'https://leafhour.com/ja'},
  '/mcp':{lang:'en',canonical:'https://leafhour.com/mcp'},
  '/zh-hans/mcp':{lang:'zh-Hans',canonical:'https://leafhour.com/zh-hans/mcp'},
  '/zh-hant/mcp':{lang:'zh-Hant',canonical:'https://leafhour.com/zh-hant/mcp'},
  '/ja/mcp':{lang:'ja',canonical:'https://leafhour.com/ja/mcp'},
  '/privacy':{lang:'en',canonical:'https://leafhour.com/privacy'},
  '/zh-hans/privacy':{lang:'zh-Hans',canonical:'https://leafhour.com/zh-hans/privacy'},
  '/zh-hant/privacy':{lang:'zh-Hant',canonical:'https://leafhour.com/zh-hant/privacy'},
  '/ja/privacy':{lang:'ja',canonical:'https://leafhour.com/ja/privacy'}
};

test('discovery files return the right formats and list only public canonical pages',async t=>{
  const base=await fixture(t),robots=await fetch(base+'/robots.txt');
  assert.equal(robots.status,200);assert.match(robots.headers.get('content-type'),/^text\/plain/);
  const rules=await robots.text();assert.match(rules,/Sitemap: https:\/\/leafhour.com\/sitemap.xml/);
  assert.match(rules,/Disallow: \/api\//);assert.doesNotMatch(rules,/Disallow: \/\s*$/m);
  const response=await fetch(base+'/sitemap.xml');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/xml/);
  const sitemap=await response.text(),urls=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
  assert.deepEqual(urls.sort(),Object.keys(pages).map(route=>'https://leafhour.com'+route).sort());
  for(const url of urls){assert.equal(new URL(url).search,'');const r=await fetch(base+new URL(url).pathname);assert.equal(r.status,200);assert.doesNotMatch(await r.text(),/<meta name="robots" content="noindex/);}
});

test('every language discovery page exposes usable content and metadata before JavaScript runs',async t=>{
  const base=await fixture(t);
  for(const [route,{lang,canonical}]of Object.entries(pages)){
    const response=await fetch(base+route),html=await response.text();assert.equal(response.status,200);
    assert.match(html,new RegExp('<html lang="'+lang+'">'));assert.equal(new RegExp('<link rel="canonical" href="'+canonical.replace(/[/.]/g,'\\$&')+'">').test(html),true);
    assert.match(html,/<h1[^>]*>[^<]+<\/h1>/);assert.match(html,/<meta name="description" content="[^"]{24,}"/);
    if(route==='/'){assert.ok(html.includes('href="/library"'),'automatic root preserves browser/account choice before JavaScript');assert.ok(!html.includes('href="/library?ui=en"'),'root does not force its English fallback on early navigation');}
    else assert.ok(html.includes('href="/library?ui='+lang+'"'),route+' preserves its authored locale in canonical navigation');
    assert.match(html,/href="https:\/\/github.com\/getyak\/leafhour/);
    assert.ok(schemas(html).some(s=>s['@type']==='WebPage'||s['@type']==='TechArticle'));
    assert.doesNotMatch(html,/aggregateRating|reviewCount|"offers"/);
  }
});

test('homepages link every public language and declare hreflang alternates',async t=>{
  const base=await fixture(t);
  for(const route of ['/','/zh-hans','/zh-hant','/ja']){
    const html=await (await fetch(base+route)).text();
    for(const [other,lang]of [['/','en'],['/zh-hans','zh-Hans'],['/zh-hant','zh-Hant'],['/ja','ja']])assert.ok(html.includes('hreflang="'+lang+'" href="https://leafhour.com'+other+'"'),route+' must alternate '+other);
    assert.ok(html.includes('hreflang="x-default" href="https://leafhour.com/"'));
    assert.ok(schemas(html).some(s=>s['@type']==='SoftwareApplication'&&s.name==='Leafhour'));
    for(const other of ['/en','/zh-hans','/zh-hant','/ja'])assert.ok(html.includes('href="'+other+'"'),route+' must link '+other);
    const prefix=route==='/'?'':route;
    assert.ok(html.includes('href="'+prefix+'/mcp"'),route+' must link its MCP guide');
    assert.ok(html.includes('href="'+prefix+'/privacy"'),route+' must link its privacy notice');
  }
  const english=await (await fetch(base+'/')).text();
  assert.match(english,/Chinese/);assert.match(english,/PDF/);assert.match(english,/Markdown/);
  const alias=await (await fetch(base+'/en')).text();
  assert.match(alias,/<link rel="canonical" href="https:\/\/leafhour.com\/">/);
  assert.match(await (await fetch(base+'/en/mcp')).text(),/<link rel="canonical" href="https:\/\/leafhour.com\/mcp">/);
});

test('private shells and API responses remain excluded from search even with query parameters',async t=>{
  const base=await fixture(t);
  for(const route of ['/library?login=1','/read?book=gutenberg-alice','/gift-preview','/gift/'+'A'.repeat(43),'/evals','/api/auth/session','/api/library']){
    const response=await fetch(base+route);assert.equal(response.status,200);
    assert.match(response.headers.get('x-robots-tag'),/noindex/);
    const body=await response.text();
    if(response.headers.get('content-type').includes('text/html')){
      assert.match(body,/<meta name="robots" content="noindex/);
      assert.doesNotMatch(body.split('</head>')[0],/application\/ld\+json|hreflang=/,'private shells must not inherit public product discovery data');
    }
  }
});

test('search crawlers see the same public facts as people and no private data',async t=>{
  const base=await fixture(t),human=await (await fetch(base+'/')).text();
  for(const agent of ['Googlebot','OAI-SearchBot','Claude-SearchBot','PerplexityBot']){
    const response=await fetch(base+'/',{headers:{'User-Agent':agent}});assert.equal(response.status,200);assert.equal(await response.text(),human);
  }
  const denied=await fetch(base+'/api/library/export');assert.equal(denied.status,401);
});
