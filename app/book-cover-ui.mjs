import {createBookCoverPainter} from './book-binding.mjs';
import {getUiLocale,onUiLocaleChange} from './ui-locale.mjs';
export {bookCoverLabel,bookCoverSearchText} from './book-binding.mjs';

// One page owner for the shared renderer. Weak references let shelf refresh,
// account changes and closed gift dialogs discard their old nodes normally.
const painter=createBookCoverPainter({getLocale:getUiLocale,onLocaleChange:onUiLocaleChange});
const styledDocuments=new WeakSet();
const ensureStyle=document=>{
  if(!document?.head||styledDocuments.has(document))return;
  if(!document.getElementById('book-binding-style')){const style=document.createElement('link');style.id='book-binding-style';style.rel='stylesheet';style.href='/book-binding.css';document.head.append(style);}
  styledDocuments.add(document);
};
export const paintBookCover=(cover,book)=>{ensureStyle(cover.ownerDocument);return painter.paint(cover,book);};
export const paintBookIdentity=(node,book,field='title')=>painter.identity(node,book,field);

// The eager reader keeps its required source-title node. Its optional About
// enhancement adds a sibling artwork only after the reader opens the bookplate.
export function paintBookAbout(document,book){
  const sourceTitle=document.getElementById('book-info-cover-title'),sourceCover=sourceTitle?.closest?.('.book-info-cover');
  if(!sourceCover)return;
  let cover=document.getElementById('book-info-artwork');
  if(!cover){cover=document.createElement('div');cover.id='book-info-artwork';cover.className='book-info-cover';cover.setAttribute('aria-hidden','true');sourceCover.parentNode.insertBefore(cover,sourceCover);}
  paintBookCover(cover,book);
  const illustrated=['illustrated','imported'].includes(cover.dataset.coverStyle);sourceCover.classList.toggle('book-info-source-cover',illustrated);sourceCover.hidden=illustrated;
  if(!illustrated){painter.forget(cover);cover.remove();}
  const title=document.getElementById('book-info-title'),author=document.getElementById('book-info-author');
  if(title)paintBookIdentity(title,book);if(author){paintBookIdentity(author,book,'author');author.setAttribute('title',book?.author||'');author.hidden=!author.textContent;}
}

export function clearBookAbout(document){
  const sourceTitle=document.getElementById('book-info-cover-title'),sourceCover=sourceTitle?.closest?.('.book-info-cover'),cover=document.getElementById('book-info-artwork');
  if(cover){painter.forget(cover);cover.remove();}
  if(sourceCover){sourceCover.classList.remove('book-info-source-cover');sourceCover.hidden=false;}
  const title=document.getElementById('book-info-title'),author=document.getElementById('book-info-author');
  if(title){painter.forget(title);if(sourceTitle)title.textContent=sourceTitle.textContent;}
  if(author){painter.forget(author);author.textContent=author.getAttribute('title')||'';author.hidden=!author.textContent;}
}
