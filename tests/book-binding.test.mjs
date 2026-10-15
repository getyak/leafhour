import test from 'node:test';
import assert from 'node:assert/strict';
import * as binding from '../app/book-binding.mjs';

class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.ownerDocument={createElement:tag=>new Element(tag)};}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
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
