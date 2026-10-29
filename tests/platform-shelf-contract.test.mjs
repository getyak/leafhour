import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'acorn';
import {fixture} from './annotation-dom-fixture.mjs';
import {createBookCoverPainter,bookCoverLabel} from '../app/book-binding.mjs';
import {stockSans,customNewsreader,observeInitialPopovers,assertInitialPopoversClosed} from '../tools/lib/platform-font-observer.mjs';

const harness=await readFile(new URL('../tools/platform-typography.mjs',import.meta.url),'utf8');
const portal=await readFile(new URL('../app/portal.js',import.meta.url),'utf8');
const cardNode=parse(portal,{ecmaVersion:'latest',sourceType:'module'}).body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='bookCard');
const start=harness.indexOf("  lifecycle.guard('library evidence');"),end=harness.indexOf("  lifecycle.guard('reader evidence');",start);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;

async function observe(mode){
 const {document}=fixture('<body><div id="library-books" aria-busy="false"></div><div id="shelf-filter-panel" popover="auto"></div><div id="library-book-menu" popover="auto"></div><button id="shelf-filter-button"></button></body>');
 document.readyState='complete';document.documentElement.lang='ja';document.fonts={ready:Promise.resolve()};
 const location={pathname:'/library'},events=[],probes=[];
 const make=(tag,cls)=>{const node=document.createElement(tag);node.className=cls||'';return node;};
 let locale='ja';const painter=createBookCoverPainter({getLocale:()=>locale}),book={bookId:'gutenberg-alice',visibility:'public',cover:'alice',title:{en:'Alice’s Adventures in Wonderland',zh:'爱丽丝梦游仙境'},author:'Lewis Carroll',source:{},paragraphs:1};
 const scope={make,readingBookUrl:()=>'/read?book=gutenberg-alice',ownedHref(){},getUiLocale:()=> 'en',bookCoverLabel,t:id=>id,paintBookCover:(node,row)=>painter.paint(node,row),paintBookIdentity:(node,row,field)=>painter.identity(node,row,field),cardLabel:node=>node,bookActions:{decorate(card){card.dataset.bookId=book.bookId;card.append(make('button','book-action-trigger'));}},shelfDrag:null,roomIcons(){},mountCardLabels(){}};
 const build=new Function(...Object.keys(scope),portal.slice(cardNode.start,cardNode.end)+';return bookCard;')(...Object.values(scope));
 document.getElementById('library-books').append(build(book));
 for(const node of document.querySelectorAll('[popover]'))node.getClientRects=()=>[];
 const cdp={evaluate:async expression=>{if(expression.includes('createRange'))return {raw:'Alice’s Adventures in Wonderland',before:4,after:4,em:16};return new Function('document','location','getComputedStyle','return ('+expression+');')(document,location,()=>({display:'none',visibility:'visible'}));}};
 const session={navigateProduct:async url=>{events.push(url);locale=new URL(url).searchParams.get('ui')||'ja';document.documentElement.lang=locale;painter.refresh();},until:async(check,label)=>assert.ok(await check(),label),fonts:async(selector,label)=>{assert.ok(selector==='#platform-apostrophe-probe'||document.querySelector(selector),'A real rendered title is required: '+selector);probes.push({selector,label});return {label,text:selector==='#platform-apostrophe-probe'?'’':document.querySelector(selector).textContent,fonts:[{familyName:selector.includes('.cover-title')?'Newsreader':'Arial',glyphCount:31,isCustomFont:selector.includes('.cover-title')}]};},cjkGlyphs:async(selector,label)=>{assert.match(document.querySelector(selector).textContent,/\p{Script=Han}/u);probes.push({selector,label});},capture:async name=>events.push(name),viewport:async()=>({width:mode==='android'?350:1200,height:900})};
 const receipt={},scopeRun={session,origin:'http://localhost:1234',cdp,args:{mode},receipt,assert,stockSans,customNewsreader,observeInitialPopovers,assertInitialPopoversClosed,lifecycle:{guard(){}},bindAndroidProductViewport:async({read})=>read(),exercisePopoverKeyboard:async options=>({trigger:options.trigger,panel:options.panel}),resolveOriginalTitleProbe:()=>assert.fail('The current public metadata title is visible at the actual narrow width')};
 await new AsyncFunction(...Object.keys(scopeRun),'let viewport={};'+harness.slice(start,end))(...Object.values(scopeRun));
 painter.dispose();return {events,probes,receipt};
}

for(const mode of ['desktop','android'])test('the '+mode+' shelf contract uses actual public cover and metadata typography after a Japanese home visit',async()=>{
 const result=await observe(mode);assert.equal(result.events[0],'http://localhost:1234/library?ui=en');
 assert.ok(result.probes.some(row=>row.selector.includes('.book-title-link')),'The real metadata title owns the stock UI glyph check');
 assert.ok(result.probes.some(row=>row.selector.includes('.cover-title')),'The real Latin cover title owns the custom serif check');
 assert.ok(!result.probes.some(row=>/binding-(?:original|title)/.test(row.selector)));
 assert.equal(result.receipt.punctuation.raw,'Alice’s Adventures in Wonderland');assert.equal(result.receipt.popoverInteractions.length,2);
});
