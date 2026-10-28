import {bookCoverArtwork} from './book-cover-artwork.mjs';
import {bookCoverLabels} from './book-cover-labels.mjs';

// Pure shared rendering: UI-language subscriptions belong to book-cover-ui.mjs.
const tones=['sage','lichen','slate','clay','linen'];
const catalog={alice:'sage',meditations:'clay',walden:'linen'};
const renderedCovers=new WeakMap();
const locales=new Set(['en','zh-Hans','zh-Hant','ja']);
const assetPattern=/^\/book-covers\/[a-z0-9-]+-(320|640)\.webp\?v=[a-f0-9]{12}$/;
const colorPattern=/^#[a-f0-9]{6}$/i;
// Adjacent titles and native selectors must identify the edition even when
// several public volumes share the same short cover title in one language.
const duplicateTitles=Object.fromEntries([...locales].map(locale=>{
  const counts=new Map();for(const entry of Object.values(bookCoverLabels)){const title=entry[locale]?.title;if(title)counts.set(title,(counts.get(title)||0)+1);}
  return [locale,new Set([...counts].filter(([,count])=>count>1).map(([title])=>title))];
}));

export function bookCoverLabel(book,locale='en'){
  const code=locales.has(locale)?locale:'en',key=String(book?.bookId||'');
  if(book?.visibility==='public'&&Object.hasOwn(bookCoverLabels,key)){
    const label=bookCoverLabels[key][code];return label.subtitle&&duplicateTitles[code].has(label.title)?{...label,title:label.title+' · '+label.subtitle}:label;
  }
  return {title:book?.title?.zh||book?.title?.en||'',author:book?.author||'',subtitle:book?.title?.en!==book?.title?.zh?book?.title?.en||'':''};
}

function paintIdentity(node,book,field,locale){
  const value=bookCoverLabel(book,locale)[field]||'',language=book?.visibility==='public'&&Object.hasOwn(bookCoverLabels,String(book?.bookId||''))?locale:'und';node.textContent=value;node.lang=language;node.setAttribute?.('lang',language);return node;
}

// Search the identities people can actually see, without rewriting source data
// or tying an existing query to a later interface-language change.
export function bookCoverSearchText(book){
  const key=String(book?.bookId||'');
  if(book?.visibility!=='public'||!Object.hasOwn(bookCoverLabels,key))return '';
  return [...locales].map(locale=>{const label=bookCoverLabel(book,locale);return [label.title,label.author,label.subtitle].filter(Boolean).join(' ');}).join('\n');
}

function artworkFor(id){
  if(!Object.hasOwn(bookCoverArtwork,id))return null;
  const artwork=bookCoverArtwork[id];
  if(!artwork||!assetPattern.test(artwork.src)||!/-640\.webp\?v=/.test(artwork.src))return null;
  const sources=String(artwork.srcSet||'').split(',').map(value=>value.trim());
  if(sources.length!==2||!sources.every((source,index)=>{
    const [url,width,...extra]=source.split(/\s+/);return !extra.length&&assetPattern.test(url)&&width===(index===0?'320w':'640w')&&url.includes(index===0?'-320.webp?':'-640.webp?');
  }))return null;
  return artwork;
}

function bindNative(cover,book){
  delete cover.dataset.coverStyle;delete cover.dataset.coverArtwork;delete cover.dataset.coverTitleSize;
  cover.style?.removeProperty?.('--cover-ink');cover.style?.removeProperty?.('--cover-paper');
  cover.setAttribute?.('lang','und');renderedCovers.delete(cover);
  const document=cover.ownerDocument,inner=document.createElement('div');inner.className='binding-type';
  for(const [tag,className,value] of [['small','binding-author',book?.author],['strong','binding-title',book?.title?.zh||book?.title?.en],['small','binding-original',book?.title?.en!==book?.title?.zh?book?.title?.en:'']]){
    if(!value)continue;const line=document.createElement(tag);line.className=className;line.textContent=value;inner.append(line);
  }
  cover.replaceChildren(inner);
}

export function paintBookCover(cover,book,options={}){
  const key=String(book?.bookId||''),locale=locales.has(options.locale)?options.locale:'en';
  let hash=0;for(const character of key)hash=(Math.imul(hash,31)+character.codePointAt(0))>>>0;
  cover.dataset.binding=Object.hasOwn(catalog,book?.cover)?catalog[book.cover]:tones[hash%tones.length];
  const labels=book?.visibility==='public'&&Object.hasOwn(bookCoverLabels,key)?bookCoverLabels[key][locale]:null;
  if(!labels?.title){bindNative(cover,book);return cover;}
  const artwork=artworkFor(key);let view=renderedCovers.get(cover);
  if(!view||view.key!==key){
    const document=cover.ownerDocument,inner=document.createElement('div');inner.className='cover-labels';
    const line=(tag,className)=>{const node=document.createElement(tag);node.className=className;inner.append(node);return node;};
    const brand=line('small','cover-brand'),title=line('strong','cover-title'),subtitle=line('small','cover-subtitle'),author=line('small','cover-author');brand.textContent='leafhour';brand.setAttribute?.('lang','en');
    view={key,inner,title,subtitle,author,image:null};
    if(artwork){
      const image=document.createElement('img');image.className='cover-artwork';image.alt='';image.setAttribute?.('aria-hidden','true');image.loading='lazy';image.decoding='async';image.width=640;image.height=960;
      image.sizes='(max-width: 600px) 128px, 180px';image.srcset=artwork.srcSet;image.src=artwork.src;view.image=image;
      image.addEventListener('error',()=>{if(renderedCovers.get(cover)!==view)return;image.hidden=true;cover.dataset.coverArtwork='failed';},{once:true});
      cover.replaceChildren(image,inner);
    }else cover.replaceChildren(inner);
    renderedCovers.set(cover,view);cover.dataset.coverArtwork=artwork?'ready':'missing';
  }
  cover.dataset.coverStyle='illustrated';cover.setAttribute?.('lang',locale);
  cover.style?.setProperty?.('--cover-ink',colorPattern.test(artwork?.ink)?artwork.ink:'#243b32');
  cover.style?.setProperty?.('--cover-paper',colorPattern.test(artwork?.paper)?artwork.paper:'#eee8d7');
  const cjk=locale!=='en',length=labels.title.length;cover.dataset.coverTitleSize=length>(cjk?20:42)?'longest':length>(cjk?13:26)?'long':'normal';
  for(const [node,value]of [[view.title,labels.title],[view.subtitle,labels.subtitle],[view.author,labels.author]]){
    node.textContent=value||'';node.hidden=!value;node.setAttribute?.('title',value||'');
  }
  return cover;
}

// One locale owner can cover many physical cards without keeping removed cards
// or their private book metadata alive. Commits update only labels: the image,
// container and each text node keep their physical identity.
export function createBookCoverPainter({getLocale=()=> 'en',onLocaleChange=()=>()=>{}}={}){
  let records=new WeakMap(),disposed=false,pruneQueued=false;
  const references=new Set();
  const remember=(cover,book,field)=>{
    const record=records.get(cover)||{reference:new WeakRef(cover)};record.book=book;record.field=field;records.set(cover,record);references.add(record.reference);
    if(!pruneQueued){pruneQueued=true;queueMicrotask(()=>{pruneQueued=false;if(!disposed)prune();});}
  };
  const prune=()=>{for(const reference of references){const cover=reference.deref();if(!cover||cover.isConnected===false)references.delete(reference);}};
  const refresh=()=>{
    if(disposed)return;prune();const locale=getLocale();
    for(const reference of references){const cover=reference.deref(),record=cover&&records.get(cover);if(record){if(record.field)paintIdentity(cover,record.book,record.field,locale);else paintBookCover(cover,record.book,{locale});}}
  };
  const unsubscribe=onLocaleChange(refresh);
  return {
    paint(cover,book){
      if(disposed)return cover;
      remember(cover,book,null);
      return paintBookCover(cover,book,{locale:getLocale()});
    },
    identity(node,book,field='title'){
      if(disposed)return node;const property=field==='author'?'author':'title';remember(node,book,property);return paintIdentity(node,book,property,getLocale());
    },
    forget(node){const record=records.get(node);if(record)references.delete(record.reference);records.delete(node);},
    refresh,
    dispose(){if(disposed)return;disposed=true;unsubscribe?.();references.clear();records=new WeakMap();}
  };
}
