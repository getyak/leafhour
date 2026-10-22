import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiLocale} from '../app/ui-locale.mjs';
import ja from '../app/ui-catalogs/ja.mjs';
import {mountSiteAppearance, getSiteAppearance, setSiteAppearance, appearanceModes, appearanceStorageKey} from '../app/site-appearance.mjs';

// A small synthetic DOM: the appearance module only touches element creation,
// attributes, listeners, focus and the storage surface, so no browser is needed.
class FakeElement {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.parentElement = null;
    this.hidden = false;
    this.checked = false;
    this.textContent = '';
    this.style = {};
    this.dataset = {};
    this.title = '';
    this.focused = 0;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  get href() { return this.getAttribute('href'); }
  set href(value) { this.setAttribute('href',value); }
  querySelectorAll(selector) {
    const visit=node=>node.children.flatMap(child=>[child,...visit(child)]);
    assert.equal(selector,'a[href]');
    return visit(this).filter(node=>node.tagName==='A'&&node.getAttribute('href')!==null);
  }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  dispatch(type, event = {}) {
    event.target ??= this;
    event.defaultPrevented ??= false;
    event.preventDefault ??= function () { this.defaultPrevented = true; };
    for (const handler of this.listeners.get(type) || []) handler(event);
    return event;
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }
  after(node) {
    const parent = this.parentElement;
    node.parentElement = parent;
    parent.children.splice(parent.children.indexOf(this) + 1, 0, node);
  }
  contains(target) {
    for (let node = target; node; node = node.parentElement) if (node === this) return true;
    return false;
  }
  focus() {
    this.focused++;
    this.ownerDocument.activeElement = this;
  }
  getBoundingClientRect() { return {left: 120, right: 164, top: 20, bottom: 64}; }
}

class FakeDocument {
  constructor(lang = 'zh-Hans') {
    this.documentElement = new FakeElement('html', this);
    this.documentElement.lang = lang;
    this.body = new FakeElement('body', this);
    this.activeElement = this.body;
    this.listeners = new Map();
    this.events = [];
  }
  createElement(tag) { return new FakeElement(tag, this); }
  getElementById(id) { return this.trigger && this.trigger.getAttribute('id') === id ? this.trigger : null; }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  dispatch(type, event = {}) {
    event.target ??= this.body;
    event.defaultPrevented ??= false;
    event.preventDefault ??= function () { this.defaultPrevented = true; };
    for (const handler of this.listeners.get(type) || []) handler(event);
    return event;
  }
  dispatchEvent(event) {
    this.events.push(event);
    return true;
  }
}

class FakeWindow {
  constructor() {
    this.listeners = new Map();
    this.innerWidth = 1200;
    this.CustomEvent = class CustomEvent {
      constructor(type, {detail} = {}) { this.type = type; this.detail = detail; }
    };
  }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  emitStorage(event) { for (const handler of this.listeners.get('storage') || []) handler(event); }
}

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    read: key => (map.has(key) ? map.get(key) : null)
  };
}

function fixture({lang = 'zh-Hans', stored = null, ui, page, anchors=[]} = {}) {
  const doc = new FakeDocument(lang), win = new FakeWindow(), storage = fakeStorage(stored === null ? {} : {[appearanceStorageKey]: stored});
  const trigger = new FakeElement('button', doc);
  trigger.setAttribute('id', 'site-theme');
  trigger.parentElement = doc.body;
  doc.trigger = trigger;
  doc.body.append(trigger);
  if(page)doc.body.dataset.palettePage=page;
  const links=anchors.map(({href,...attrs})=>{const link=doc.createElement('a');link.href=href;link.textContent='著者の文章';for(const [key,value] of Object.entries(attrs))link.setAttribute(key,value);doc.body.append(link);return link;});
  const writes=[];const write=storage.setItem;storage.setItem=(...args)=>{writes.push(args);write(...args);};
  const owner=mountSiteAppearance(doc, {win, storage,ui});
  const menu = trigger.parentElement.children.find(node => node.id === 'site-appearance-menu');
  const radios = {};
  const walk = node => {
    if (node.tagName === 'INPUT') radios[node.getAttribute('value')] = node;
    for (const child of node.children || []) walk(child);
  };
  walk(menu);
  return {doc, win, storage, trigger, menu, radios, links, owner, writes};
}

test('a footer appearance trigger opens its choices inside the viewport', () => {
  const {win,trigger,menu}=fixture();
  win.innerHeight=800;
  trigger.getBoundingClientRect=()=>({left:1100,right:1144,top:740,bottom:784});
  menu.offsetWidth=210;menu.offsetHeight=180;
  trigger.dispatch('click');
  assert.equal(menu.hidden,false);
  assert.ok(parseFloat(menu.style.top)>=8);
  assert.ok(parseFloat(menu.style.top)+menu.offsetHeight<=win.innerHeight-8);
  assert.ok(parseFloat(menu.style.left)+menu.offsetWidth<=win.innerWidth-8);
});

test('the header trigger opens a labelled popover of native radios with the current mode visible', () => {
  const {doc, trigger, menu, radios} = fixture({stored: 'night'});
  assert.equal(getSiteAppearance(), 'night');
  assert.equal(menu.hidden, true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(trigger.getAttribute('aria-controls'), 'site-appearance-menu');
  trigger.dispatch('click');
  assert.equal(menu.hidden, false);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  const legend = menu.children[0].children[0];
  assert.equal(legend.textContent, 'Page appearance');
  assert.deepEqual(Object.keys(radios).sort(), [...appearanceModes].sort());
  for (const value of appearanceModes) assert.equal(radios[value].getAttribute('type'), 'radio');
  assert.equal(radios['night'].checked, true, 'the current mode stays visible in the checked choice');
  assert.match(trigger.getAttribute('aria-label'), /Appearance: Night/);
  assert.equal(doc.documentElement.dataset.siteTheme, 'night');
});

test('choosing a mode applies it immediately and persists the compatibility key', () => {
  const {doc, storage, trigger, menu, radios} = fixture({stored: 'system'});
  trigger.dispatch('click');
  radios['paper'].checked = true;
  radios['paper'].dispatch('change');
  assert.equal(getSiteAppearance(), 'paper');
  assert.equal(storage.read(appearanceStorageKey), 'paper');
  assert.equal(doc.documentElement.dataset.siteTheme, 'paper');
  assert.equal(radios['system'].checked, false);
  const appearance = doc.events.filter(event => event.type === 'site:appearance').pop();
  assert.equal(appearance.detail, 'paper');
  trigger.dispatch('click');
  assert.equal(menu.hidden, true, 'the trigger toggles the popover closed again');
});

test('unknown stored values recover to system and setSiteAppearance rejects unknown modes', () => {
  const {storage} = fixture({stored: 'sunset'});
  assert.equal(getSiteAppearance(), 'system');
  assert.equal(setSiteAppearance('dark'), false);
  assert.equal(getSiteAppearance(), 'system');
  assert.equal(storage.read(appearanceStorageKey), 'sunset', 'a rejected mode never reaches storage');
});

test('cross-tab updates, resets and unknown values keep every tab in sync', () => {
  const {win, trigger, menu, radios} = fixture({stored: 'paper'});
  win.emitStorage({key: appearanceStorageKey, newValue: 'night'});
  assert.equal(getSiteAppearance(), 'night');
  assert.equal(radios['night'].checked, true);
  win.emitStorage({key: appearanceStorageKey, newValue: null});
  assert.equal(getSiteAppearance(), 'system', 'a cleared key falls back to system');
  win.emitStorage({key: null, newValue: null});
  assert.equal(getSiteAppearance(), 'system', 'a full storage reset falls back to system');
  win.emitStorage({key: appearanceStorageKey, newValue: 'nonsense'});
  assert.equal(getSiteAppearance(), 'system', 'invalid cross-tab values recover to system');
  win.emitStorage({key: 'marginalia-reading-font', newValue: 'song'});
  assert.equal(getSiteAppearance(), 'system', 'unrelated keys do not disturb the mode');
  trigger.dispatch('click');
  assert.equal(menu.hidden, false);
});

test('Escape closes the popover and returns focus to the trigger; outside presses close quietly', () => {
  const {doc, trigger, menu, radios} = fixture();
  trigger.dispatch('keydown', {key: 'ArrowDown'});
  assert.equal(menu.hidden, false);
  assert.ok(radios['system'].focused > 0, 'keyboard opening moves focus to the choices');
  const escape = doc.dispatch('keydown', {key: 'Escape', target: radios['system']});
  assert.equal(escape.defaultPrevented, true);
  assert.equal(menu.hidden, true);
  assert.equal(doc.activeElement, trigger, 'focus returns to the trigger on Escape');
  trigger.dispatch('click');
  assert.equal(menu.hidden, false);
  doc.dispatch('pointerdown', {target: doc.body});
  assert.equal(menu.hidden, true, 'a press outside closes the popover');
  assert.equal(doc.activeElement, trigger, 'an outside press does not move focus');
});

test('focus leaving the whole trigger/menu pair closes once, without stealing focus', () => {
  const {doc, trigger, menu} = fixture();
  const logo = new FakeElement('a', doc);
  doc.body.append(logo);
  // trigger -> outside (the Shift+Tab-to-logo case)
  trigger.dispatch('click');
  assert.equal(menu.hidden, false);
  logo.focus();
  doc.dispatch('focusin', {target: logo});
  assert.equal(menu.hidden, true, 'leaving the trigger closes the popover');
  assert.equal(doc.activeElement, logo, 'closing by focus-leave never jumps focus');
  assert.equal(trigger.focused, 0);
  const closes = () => doc.events.filter(event => event.type === 'site:appearance-menu' && event.detail === 'close').length;
  assert.equal(closes(), 1, 'exactly one close event');
  // radio -> trigger -> outside
  trigger.dispatch('keydown', {key: 'ArrowDown'});
  assert.equal(menu.hidden, false);
  trigger.focus();
  doc.dispatch('focusin', {target: trigger});
  assert.equal(menu.hidden, false, 'moving between trigger and choices keeps the popover open');
  logo.focus();
  doc.dispatch('focusin', {target: logo});
  assert.equal(menu.hidden, true);
  assert.equal(closes(), 2);
});

test('Escape works from anywhere and never double-closes', () => {
  const {doc, trigger, menu} = fixture();
  const logo = new FakeElement('a', doc);
  doc.body.append(logo);
  trigger.dispatch('click');
  // Escape while the popover is open but focus rests outside the pair.
  const escape = doc.dispatch('keydown', {key: 'Escape', target: logo});
  assert.equal(escape.defaultPrevented, true);
  assert.equal(menu.hidden, true);
  assert.equal(doc.activeElement, trigger, 'Escape returns focus to the trigger from anywhere');
  const closes = () => doc.events.filter(event => event.type === 'site:appearance-menu' && event.detail === 'close').length;
  assert.equal(closes(), 1);
  doc.dispatch('keydown', {key: 'Escape', target: doc.body});
  logo.focus();
  doc.dispatch('focusin', {target: logo});
  assert.equal(closes(), 1, 'an already closed popover emits no second close event');
  assert.equal(doc.activeElement, logo, 'late Escape/focus events do not move focus');
});

test('the popover is not a modal focus trap and lets Tab move on', () => {
  const {doc, trigger, menu} = fixture();
  trigger.dispatch('click');
  const tab = doc.dispatch('keydown', {key: 'Tab', target: trigger});
  assert.equal(tab.defaultPrevented, false, 'Tab is never captured');
  assert.equal(menu.hidden, false, 'leaving by keyboard does not lock the popover open');
});

test('every public language labels the appearance selection', async () => {
  const {requestUiRoute} = await import('../app/ui-locale.mjs');
  const expectations = [
    ['en', 'Page appearance', /Appearance: Paper/],
    ['zh-Hans', '页面外观', /页面外观：纸白/],
    ['zh-Hant', '頁面外觀', /頁面外觀：紙白/],
    ['ja', 'ページの外観', /外観：紙の白/]
  ];
  for (const [code, legend, label] of expectations) {
    await requestUiRoute(code);
    const {doc, trigger, menu, radios} = fixture({lang: code});
    assert.equal(menu.children[0].children[0].textContent, legend, code);
    trigger.dispatch('click');
    radios['paper'].checked = true;
    radios['paper'].dispatch('change');
    assert.match(trigger.getAttribute('aria-label'), label, code);
    assert.equal(doc.documentElement.dataset.siteTheme, 'paper', code);
    for (const value of appearanceModes) {
      assert.equal(radios[value].parentElement.children[1].textContent.length > 0, true, code + ' misses ' + value);
    }
  }
});


const supportRuntime=loader=>createUiLocale({loadCatalogue:loader,getLocation:()=>({href:'https://leafhour.com/ja/privacy'}),languages:['en']});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('R6 support initial catalogue failure follows actual uiReady English fallback and explicit retry',async()=>{
 const first=deferred(),retry=deferred(),attempts=[];
 const ui=supportRuntime((code,options)=>{attempts.push({code,retry:options.retry});return options.retry?retry.promise:first.promise;});
 const f=fixture({lang:'ja',page:'support',ui,anchors:[{href:'/library?ui=ja'},{href:'/read?book=a%2Fb&passage=p%207&source=literal%2Bvalue&ui=ja#note'}]});
 const retained=[...f.links],literal=f.links.map(n=>n.textContent);f.trigger.dispatch('keydown',{key:'ArrowDown'});const focus=f.doc.activeElement;
 const initial=ui.initializeOnce();assert.equal(ui.getUiLocaleState().phase,'pending');assert.equal(f.links[0].href,'/library?ui=ja');
 first.reject(Error('synthetic catalogue failure'));await initial;await ui.uiReady;await Promise.resolve();
 assert.equal(ui.getUiLocaleState().initialFallback,true);assert.equal(ui.getUiLocale(),'en');assert.equal(f.links[0].href,'/library?ui=en');assert.equal(f.links[1].href,'/read?book=a%2Fb&passage=p+7&source=literal%2Bvalue&ui=en#note');assert.equal(f.menu.children[0].children[0].textContent,ui.t('shell.appearance.title'));
 const recovering=ui.retryUiLocale();assert.equal(ui.getUiLocaleState().phase,'pending');assert.equal(f.links[0].href,'/library?ui=en');retry.resolve(ja);await recovering;
 assert.equal(ui.getUiLocale(),'ja');assert.equal(f.links[0].href,'/library?ui=ja');assert.equal(f.links[1].href,'/read?book=a%2Fb&passage=p+7&source=literal%2Bvalue&ui=ja#note');assert.equal(f.menu.children[0].children[0].textContent,ja['shell.appearance.title']);
 await ui.requestUiRoute('en');assert.equal(f.links[0].href,'/library?ui=en');f.owner.updateLabels();assert.equal(f.links[0].href,'/library?ui=en');
 assert.equal(new URL(f.links[1].href,'https://leafhour.com').searchParams.get('passage'),'p 7');assert.equal(new URL(f.links[1].href,'https://leafhour.com').searchParams.get('source'),'literal+value');
 assert.deepEqual(attempts,[{code:'ja',retry:false},{code:'ja',retry:true}]);assert.deepEqual(f.links,retained);assert.deepEqual(f.links.map(n=>n.textContent),literal);assert.equal(f.doc.documentElement.lang,'ja','authored document language remains literal');assert.equal(f.doc.activeElement,focus);assert.equal(f.menu.hidden,false);assert.deepEqual(f.writes,[]);
});

test('R6 support ready and later failed request preserve effective links without touching excluded targets',async()=>{
 const failed=deferred(),ui=supportRuntime(code=>code==='ja'?Promise.resolve(ja):failed.promise);
 const excluded=[{href:'/ja'},{href:'/ja/privacy'},{href:'/library?ui=ja',hreflang:'ja'},{href:'/read?book=one&ui=ja',download:''},{href:'https://example.org/read?book=one&signature=literal'},{href:'//example.org/library'},{href:'/api/library?ui=ja'},{href:'/library?signature=literal&ui=ja'},{href:'/read?book=one&token=literal&ui=ja'},{href:'/library/extra?ui=ja'},{href:'/read?book=one&redirect=/api'},{href:'/read?book=one\\evil'}];
 const f=fixture({lang:'ja',page:'support',ui,anchors:[{href:'/library?ui=ja'},...excluded]});await ui.initializeOnce();await ui.uiReady;
 assert.equal(f.links[0].href,'/library?ui=ja');assert.equal(f.trigger.title,ja['shell.appearance.system']);
 await ui.requestUiRoute('en');assert.equal(f.links[0].href,'/library?ui=en');
 const pending=ui.requestUiRoute('zh-Hant');assert.equal(f.links[0].href,'/library?ui=en');failed.reject(Error('synthetic failure'));await pending;f.owner.updateLabels();
 assert.equal(ui.getUiLocaleState().phase,'error');assert.equal(f.links[0].href,'/library?ui=en');assert.equal(f.trigger.title,ui.t('shell.appearance.system'));assert.deepEqual(f.links.slice(1).map(n=>n.href),excluded.map(n=>n.href));assert.deepEqual(f.writes,[]);
});

test('R6 support ownership never rewrites home library reader or an older singleton mount',async()=>{
 for(const page of ['home','library','reader',undefined]){
  const ui=supportRuntime(async()=>ja),f=fixture({ui,page,anchors:[{href:'/library?ui=ja'}]});await ui.initializeOnce();await ui.requestUiRoute('en');f.owner.updateLabels();assert.equal(f.links[0].href,'/library?ui=ja',String(page));assert.deepEqual(f.writes,[]);
 }
 const waiting=deferred(),oldUi=supportRuntime(()=>waiting.promise),old=fixture({ui:oldUi,page:'support',anchors:[{href:'/library?ui=ja'}]});const initial=oldUi.initializeOnce();
 const currentUi=supportRuntime(async()=>ja),current=fixture({ui:currentUi,page:'support',anchors:[{href:'/library?ui=ja'}]});await currentUi.initializeOnce();await currentUi.requestUiRoute('en');
 waiting.resolve(ja);await initial;await oldUi.uiReady;assert.equal(current.links[0].href,'/library?ui=en');assert.equal(current.trigger.title,currentUi.t('shell.appearance.system'));assert.equal(old.links[0].href,'/library?ui=ja');
});

test('an appearance trigger in the footer opens its menu above the viewport edge',()=>{
  const {win,trigger,menu}=fixture();
  win.innerHeight=600;
  trigger.getBoundingClientRect=()=>({left:320,right:364,top:548,bottom:592});
  menu.offsetHeight=196;
  trigger.dispatch('click');
  assert.ok(Number.parseFloat(menu.style.top)+menu.offsetHeight<=win.innerHeight-8);
  assert.equal(menu.style.top,'344px');
  assert.equal(menu.style.maxHeight,'584px');
});

test('an oversized appearance menu stays scrollable inside a short viewport',()=>{
  const {win,trigger,menu}=fixture();
  win.innerHeight=140;
  trigger.getBoundingClientRect=()=>({left:320,right:364,top:70,bottom:114});
  menu.offsetHeight=196;
  trigger.dispatch('click');
  assert.equal(menu.style.top,'8px');
  assert.equal(menu.style.maxHeight,'124px');
  assert.equal(menu.style.overflowY,'auto');
});
