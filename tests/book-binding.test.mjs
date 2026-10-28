import test from 'node:test';
import assert from 'node:assert/strict';
import * as binding from '../app/book-binding.mjs';

class Element extends EventTarget {
  constructor(tag='div'){super();this.tagName=tag;this.children=[];this.dataset={};this.attributes=new Map();this.isConnected=true;this.style={setProperty(){},removeProperty(){}};this.ownerDocument={createElement:tag=>new Element(tag)};this.sourceWrites=0;}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  removeAttribute(name){this.attributes.delete(name);}
  getAttribute(name){return this.attributes.get(name)??null;}
  set src(value){this._src=value;this.sourceWrites++;}
  get src(){return this._src;}
  set innerHTML(value){throw Error('Book metadata must remain text.');}
}
const text=element=>[element.textContent||'',...element.children.map(text)].join('');

test('the same book keeps its binding when moved between the current read, search and shelf',()=>{
  assert.equal(typeof binding.paintBookCover,'function');
  const book={bookId:'my-book-18',title:{zh:'一部自己的书',en:'An original title'},author:'真实作者'};
  const current=new Element(),shelf=new Element();
  binding.paintBookCover(current,book);binding.paintBookCover(shelf,{...book,resume:{passageId:'p1'},title:{...book.title,zh:'修改后的书名'}});
  assert.equal(current.dataset.binding,shelf.dataset.binding);
  assert.equal(text(current),'真实作者一部自己的书An original title');
  const tones=new Set(Array.from({length:12},(_,n)=>{const cover=new Element();binding.paintBookCover(cover,{...book,bookId:'upload-'+n});return cover.dataset.binding;}));
  assert.ok(tones.size>=3,'Uploaded books should not all receive the same cover.');
});

const descendants=element=>[element,...element.children.flatMap(descendants)];
const byClass=(element,name)=>descendants(element).find(node=>node.className===name);
const publicBook={bookId:'gutenberg-walden',visibility:'public',title:{zh:'来源书名',en:'Source title'},author:'Source author',coverUrl:'https://untrusted.example/private.webp'};

test('public illustrated covers use native Japanese labels and only responsive bundled artwork',()=>{
  const cover=new Element();
  assert.equal(binding.paintBookCover(cover,publicBook,{locale:'ja'}),cover,'the shared API stays synchronous');
  assert.equal(byClass(cover,'cover-title')?.textContent,'森の生活');
  assert.equal(byClass(cover,'cover-author')?.textContent,'ヘンリー・デイヴィッド・ソロー');
  assert.equal(byClass(cover,'cover-subtitle')?.textContent,'「市民の不服従」を併録');
  assert.equal(cover.getAttribute('lang'),'ja');
  const image=descendants(cover).find(node=>node.tagName==='img');
  assert.match(image?.src??'',/^\/book-covers\/[a-z0-9-]+-640\.webp\?v=[a-f0-9]{12}$/);
  assert.match(image.srcset,/\/book-covers\/[a-z0-9-]+-320\.webp\?v=[a-f0-9]{12} 320w, \/book-covers\/[a-z0-9-]+-640\.webp\?v=[a-f0-9]{12} 640w/);
  assert.equal(image.loading,'lazy');assert.equal(image.decoding,'async');
  assert.equal(image.width,640);assert.equal(image.height,960);
  assert.match(image.sizes,/180px/,'shelf thumbnails must not request a full-width image');
  assert.ok(!text(cover).includes('Source author'));
  assert.equal(publicBook.title.en,'Source title','cover localization never rewrites reading metadata');
});

test('private public-looking IDs and unknown imported titles retain literal source metadata with no images',()=>{
  const title='<img src=x onerror=alert(1)> 私の本',book={...publicBook,visibility:'private',title:{zh:title,en:title},author:'本当の著者'};
  for(const input of [book,{...book,bookId:'unknown-upload',visibility:'public'}]){
    const cover=new Element();binding.paintBookCover(cover,input,{locale:'ja'});
    assert.equal(text(cover),'本当の著者'+title);
    assert.equal(descendants(cover).some(node=>node.tagName==='img'),false);
    assert.equal(cover.dataset.coverStyle,undefined);
  }
});

test('failed artwork leaves readable localized title and author',()=>{
  const cover=new Element();binding.paintBookCover(cover,publicBook,{locale:'zh-Hant'});
  const image=descendants(cover).find(node=>node.tagName==='img');
  assert.ok(image,'the public edition has artwork');image.dispatchEvent(new Event('error'));
  assert.equal(image.hidden,true);assert.equal(cover.dataset.coverArtwork,'failed');
  assert.equal(byClass(cover,'cover-title').textContent,'瓦爾登湖');
  assert.equal(byClass(cover,'cover-author').textContent,'亨利·大衛·梭羅');
});

test('language commits update existing connected covers in place without loading artwork again',()=>{
  assert.equal(typeof binding.createBookCoverPainter,'function');
  let locale='en',commit;const painter=binding.createBookCoverPainter({getLocale:()=>locale,onLocaleChange:listener=>{commit=listener;return()=>{};}});
  const cover=new Element(),detached=new Element();painter.paint(cover,publicBook);painter.paint(detached,publicBook);
  const image=descendants(cover).find(node=>node.tagName==='img'),title=byClass(cover,'cover-title'),originalChildren=[...cover.children],writes=image.sourceWrites;
  detached.isConnected=false;locale='ja';commit(locale);
  assert.equal(title.textContent,'森の生活');assert.deepEqual(cover.children,originalChildren);
  assert.equal(descendants(cover).find(node=>node.tagName==='img'),image);assert.equal(image.sourceWrites,writes);
  assert.equal(byClass(detached,'cover-title').textContent,'Walden','detached cards are not refreshed');
  locale='zh-Hans';commit(locale);assert.equal(title.textContent,'瓦尔登湖');
  painter.dispose();locale='en';commit(locale);assert.equal(title.textContent,'瓦尔登湖','disposed owners stay inert');
});

test('adjacent public title and author nodes share cover language while private identity stays native',()=>{
  assert.equal(typeof binding.bookCoverLabel,'function');
  let locale='en',commit;const painter=binding.createBookCoverPainter({getLocale:()=>locale,onLocaleChange:listener=>{commit=listener;return()=>{};}}),title=new Element(),author=new Element(),privateTitle=new Element();
  assert.equal(typeof painter.identity,'function');painter.identity(title,publicBook);painter.identity(author,publicBook,'author');painter.identity(privateTitle,{...publicBook,visibility:'private'});
  assert.equal(title.textContent,'Walden');assert.equal(author.textContent,'Henry David Thoreau');assert.equal(privateTitle.textContent,'来源书名');
  locale='ja';commit();assert.equal(title.textContent,'森の生活');assert.equal(author.textContent,'ヘンリー・デイヴィッド・ソロー');assert.equal(privateTitle.textContent,'来源书名');
  assert.equal(binding.bookCoverLabel({...publicBook,visibility:'private'},'ja').title,'来源书名');painter.dispose();
});

test('duplicate public edition identities include scope while the cover keeps its short title',()=>{
  const groups=[
    ['gutenberg-dream-red-chamber-',{
      en:['Dream of the Red Chamber','Volume 1 · Chapters 1–40 · Chinese text','Volume 2 · Chapters 41–80 · Chinese text'],
      'zh-Hans':['红楼梦','第 1 册 · 第 1—40 回 · 中文原典','第 2 册 · 第 41—80 回 · 中文原典'],
      'zh-Hant':['紅樓夢','第 1 冊 · 第 1—40 回 · 中文原典','第 2 冊 · 第 41—80 回 · 中文原典'],
      ja:['紅楼夢','第 1 冊 · 第 1–40 回 · 中国語本文','第 2 冊 · 第 41–80 回 · 中国語本文']
    }],
    ['gutenberg-essays-montaigne-',{
      en:['The Essays of Montaigne','Book 1 · English translation','Book 2 · English translation'],
      'zh-Hans':['蒙田随笔','第 1 卷 · 英译本','第 2 卷 · 英译本'],
      'zh-Hant':['蒙田隨筆','第 1 卷 · 英譯本','第 2 卷 · 英譯本'],
      ja:['エセー','第 1 巻 · 英訳本文','第 2 巻 · 英訳本文']
    }],
    ['gutenberg-world-will-idea-',{
      en:['The World as Will and Idea','English edition · Volume 1 of 3','English edition · Volume 2 of 3'],
      'zh-Hans':['作为意志和表象的世界','英译第 1 册 · 共 3 册','英译第 2 册 · 共 3 册'],
      'zh-Hant':['作為意志和表象的世界','英譯第 1 冊 · 共 3 冊','英譯第 2 冊 · 共 3 冊'],
      ja:['意志と表象としての世界','英訳版・第 1 冊（全 3 冊）','英訳版・第 2 冊（全 3 冊）']
    }]
  ];
  for(const [prefix,locales]of groups)for(const [locale,[title,first,second]]of Object.entries(locales))for(const [volume,scope]of [[1,first],[2,second]]){
    const book={bookId:prefix+volume,visibility:'public',title:{zh:'Metadata title'},author:'Metadata author'},cover=new Element();
    assert.equal(binding.bookCoverLabel(book,locale).title,title+' · '+scope);
    binding.paintBookCover(cover,book,{locale});assert.equal(byClass(cover,'cover-title').textContent,title);
    assert.equal(binding.bookCoverLabel({...book,visibility:'private'},locale).title,'Metadata title');
  }
  assert.equal(binding.bookCoverLabel({bookId:'gutenberg-tao-te-ching',visibility:'public'},'ja').title,'老子 · 英語本文');
  assert.equal(binding.bookCoverLabel({bookId:'gutenberg-tao-te-ching-zh',visibility:'public'},'ja').title,'老子 · 中国語本文');
  assert.equal(binding.bookCoverLabel(publicBook,'en').title,'Walden','unique titles do not acquire a subtitle');
});

test('reusing an illustrated node for a private book removes the previous art and native labels',()=>{
  const cover=new Element();binding.paintBookCover(cover,publicBook,{locale:'ja'});
  assert.equal(cover.dataset.coverStyle,'illustrated');
  binding.paintBookCover(cover,{bookId:'uploaded',visibility:'private',title:{zh:'我自己的书'},author:'原作者'},{locale:'ja'});
  assert.equal(text(cover),'原作者我自己的书');
  assert.equal(cover.dataset.coverStyle,undefined);assert.equal(descendants(cover).some(node=>node.tagName==='img'),false);
});

test('repainting a cover replaces old metadata, preserves long titles and inserts no fabricated author',()=>{
  assert.equal(typeof binding.paintBookCover,'function');
  const cover=new Element(),title='<img onerror=alert(1)> 很长的书名😀'.repeat(6);
  binding.paintBookCover(cover,{bookId:'old',title:{zh:'旧书'},author:'旧作者'});
  binding.paintBookCover(cover,{bookId:'new',cover:'"><script>',title:{zh:title}});
  assert.equal(text(cover),title);
  assert.equal(cover.children.length,1);
  assert.match(cover.dataset.binding,/^[a-z]+$/);
  assert.ok(!text(cover).includes('旧作者'));
});
