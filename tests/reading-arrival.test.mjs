import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as arrival from '../app/reading-arrival.mjs';

function setup() {
  const timers=new Map(),views=[];let next=0;
  const state=arrival.createArrivalLifecycle({render:view=>views.push(view),schedule:fn=>{timers.set(++next,fn);return next;},cancel:id=>timers.delete(id)});
  return {state,timers,views,slow(){const fn=[...timers.values()][0];timers.clear();fn?.();}};
}

test('ready content dismisses the arrival immediately and cancels the slow-load reminder',()=>{
  const {state,timers,views}=setup(),ticket=state.start();
  assert.equal(views.at(-1).phase,'loading');
  assert.equal(state.finish(ticket),true);
  assert.deepEqual(views.at(-1),{phase:'hidden',slow:false});
  assert.equal(timers.size,0);
});

test('a late completion or timer from an earlier attempt cannot dismiss or change a retry',()=>{
  const {state,timers,views}=setup(),old=state.start(),oldTimer=[...timers.values()][0],current=state.start();
  oldTimer();assert.equal(views.at(-1).slow,false);
  assert.equal(state.finish(old),false);assert.equal(views.at(-1).phase,'loading');
  assert.equal(state.finish(current),true);assert.equal(views.at(-1).phase,'hidden');
});

test('the slower-load message only appears while that same load remains pending',()=>{
  const {state,views,slow}=setup(),ticket=state.start();slow();
  assert.deepEqual(views.at(-1),{phase:'loading',slow:true});
  state.finish(ticket);assert.equal(views.at(-1).phase,'hidden');
  state.start();assert.deepEqual(views.at(-1),{phase:'loading',slow:false});
});

test('arrival quotes preserve catalog source text, translation provenance and the matching book',async()=>{
  const catalog=JSON.parse(await readFile(new URL('../catalog/manifest.json',import.meta.url)));
  for(const book of catalog){
    const quote=arrival.arrivalQuote(book.id);
    assert.equal(quote.bookId,book.id);
    assert.equal(quote.sourceUrl,book.sourceUrl);
    const source=(await readFile(new URL('../catalog/'+book.file,import.meta.url),'utf8')).replace(/[_\s]+/g,' ');
    assert.ok(source.includes(quote.original.replace(/[_\s]+/g,' ')),book.id+' quote must exist verbatim in its source');
    const translations=JSON.parse(await readFile(new URL('../catalog/translations/'+book.id+'.zh.json',import.meta.url)));
    const passage=translations.passages.find(row=>row.id===quote.passageId);
    assert.ok(passage.translations[quote.variant].text.includes(quote.translation));
    assert.equal(quote.status,passage.translations[quote.variant].status);
    assert.equal(quote.contentVersion,translations.contentVersion);
  }
});

test('an unknown or private book uses a clearly separate public reading-room quote',()=>{
  const quote=arrival.arrivalQuote('private-book');
  assert.equal(quote.context,'书房拾句');
  assert.equal(quote.bookId,'gutenberg-alice');
  assert.equal(arrival.arrivalQuote('gutenberg-alice').context,'书中一句');
});
