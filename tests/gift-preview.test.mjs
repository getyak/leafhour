import test from 'node:test';
import assert from 'node:assert/strict';
const preview=await import('../app/gift-preview.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const book={bookId:'walden',title:{zh:'瓦尔登湖',en:'Walden'},author:'Henry David Thoreau',description:'湖畔的一本书。',visibility:'public',sections:[{private:'whole original'}],records:{notes:['private note']},source:{filename:'/private/home/book.pdf'}};
test('a local letter preview sends only visible stationery fields, without publishing a book or leaking records',()=>{
  assert.equal(typeof preview.createGiftPreview,'function');
  const message=preview.createGiftPreview(book,{displayName:'林间读者',email:'private@example.com'},{recipient:'小林',message:'这段话让我想起你。',includeTranslations:false},{now:new Date('2026-10-16T00:00:00Z')});
  assert.deepEqual(message,{kind:'marginalia-gift-preview',version:1,gift:{bookId:'walden',title:{zh:'瓦尔登湖',en:'Walden'},author:'Henry David Thoreau',description:'湖畔的一本书。',sender:'林间读者',recipient:'小林',message:'这段话让我想起你。',includeTranslations:false,createdAt:'2026-10-16T00:00:00.000Z',publicRead:true}});
});
test('the preview frame accepts its own parent only and strips unrecognised fields',()=>{
  assert.equal(typeof preview.readGiftPreview,'function');const source={},other={},origin='https://reader.example.com';
  const data={kind:'marginalia-gift-preview',version:1,gift:{bookId:'alice',title:{zh:'爱丽丝'},sender:'寄信人',recipient:'朋友',message:'<script>unsafe text</script>',includeTranslations:true,createdAt:'2026-10-16T00:00:00Z',publicRead:false,token:'must not survive',readUrl:'https://outside.example',records:{notes:['secret']}}};
  assert.equal(preview.readGiftPreview({origin:'https://outside.example',source,data},{origin,source}),null);
  assert.equal(preview.readGiftPreview({origin,source:other,data},{origin,source}),null);
  const value=preview.readGiftPreview({origin,source,data},{origin,source});assert.equal(value.message,'<script>unsafe text</script>');assert.equal(value.publicRead,false);assert.equal(value.token,undefined);assert.equal(value.readUrl,undefined);assert.equal(value.records,undefined);
  assert.equal(preview.readGiftPreview({origin,source,data:{...data,version:2}},{origin,source}),null);
});
test('a malformed or excessively large preview cannot enter the recipient view',()=>{
  assert.equal(typeof preview.readGiftPreview,'function');const source={},origin='https://reader.example.com',event=gift=>({origin,source,data:{kind:'marginalia-gift-preview',version:1,gift}});
  for(const gift of [null,[],{bookId:'alice',createdAt:'not a date'},{bookId:'alice',title:{zh:'a'},createdAt:'2026-10-16',message:'a'.repeat(501)}])assert.equal(preview.readGiftPreview(event(gift),{origin,source}),null);
});

test('only the public preview page can be framed by this reader, while letters and the library stay protected',async t=>{
  const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path'),{createReaderServer}=await import('../server/server.mjs');
  const directory=await mkdtemp(path.join(tmpdir(),'reader-gift-preview-')),server=await createReaderServer({bookPath:path.join(directory,'absent.json'),recordsPath:path.join(directory,'records.json'),portalDataDir:path.join(directory,'portal'),allowLocal:false,translator:null,chatGenerator:null});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await rm(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port,response=await fetch(base+'/gift-preview');assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'self'/);assert.ok((await response.text()).includes('id="gift-open"'));
  for(const route of ['/library','/gift/'+'A'.repeat(43)]){const other=await fetch(base+route);assert.equal(other.status,200);assert.match(other.headers.get('content-security-policy'),/frame-ancestors 'none'/);}
});

const quote={receipt:'R'.repeat(32),selection:'ai-selected',text:'Read this first.',chapterTitle:'Opening',passageId:'p1'};
test('the preview carries a prepared quotation with its honest source label and drops forged ones',()=>{
  assert.equal(typeof preview.createGiftPreview,'function');
  const message=preview.createGiftPreview(book,{displayName:'林间读者'},{recipient:'小林',message:'这段话让我想起你。',includeTranslations:true,quote});
  assert.deepEqual(message.gift.quote,quote);
  for(const bad of [{...quote,receipt:'short'},{...quote,receipt:undefined},{...quote,receipt:42},{...quote,selection:'ai-picked'},{...quote,text:'FORGED <img src=x>'},{...quote,text:'x'.repeat(241)},{...quote,chapterTitle:'c'.repeat(201)},{...quote,passageId:'p'.repeat(129)},{selection:'original-excerpt',text:'No receipt at all.'},'not an object',null,[]]){
    assert.equal(preview.createGiftPreview(book,{displayName:'x'},{quote:bad}).gift.quote,undefined,'an unknown receipt fails closed: '+JSON.stringify(bad));
  }
});
test('the preview frame keeps only quotations bound to a prepared receipt',()=>{
  assert.equal(typeof preview.readGiftPreview,'function');const source={},origin='https://reader.example.com';
  const gift={bookId:'alice',title:{zh:'爱丽丝'},sender:'寄信人',recipient:'朋友',message:'见字如面',includeTranslations:true,createdAt:'2026-10-16T00:00:00Z',publicRead:false,quote};
  const value=preview.readGiftPreview({origin,source,data:{kind:'marginalia-gift-preview',version:1,gift}},{origin,source});
  assert.deepEqual(value.quote,quote);
  for(const bad of [{...quote,receipt:'forged'},{...quote,selection:'ai-selected',text:'<script>evil()</script>'},{...quote,text:'x'.repeat(241)},null,'text',[]]){
    const dropped=preview.readGiftPreview({origin,source,data:{kind:'marginalia-gift-preview',version:1,gift:{...gift,quote:bad}}},{origin,source});
    assert.equal(dropped.quote,undefined,'forged quotation never reaches the recipient view: '+JSON.stringify(bad));
    assert.equal(dropped.message,'见字如面','the rest of the letter still previews');
  }
});
