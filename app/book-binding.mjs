// Shared book cover rendering for the current read and the library shelf.
const tones=['sage','lichen','slate','clay','linen'];
const catalog={alice:'sage',meditations:'clay',walden:'linen'};

export function paintBookCover(cover,book){
  const key=String(book?.bookId||'');
  let hash=0;for(const character of key)hash=(Math.imul(hash,31)+character.codePointAt(0))>>>0;
  cover.dataset.binding=Object.hasOwn(catalog,book?.cover)?catalog[book.cover]:tones[hash%tones.length];
  const document=cover.ownerDocument,inner=document.createElement('div');inner.className='binding-type';
  for(const [tag,className,value] of [['small','binding-author',book?.author],['strong','binding-title',book?.title?.zh||book?.title?.en],['small','binding-original',book?.title?.en!==book?.title?.zh?book?.title?.en:'']]){
    if(!value)continue;const line=document.createElement(tag);line.className=className;line.textContent=value;inner.append(line);
  }
  cover.replaceChildren(inner);return cover;
}
