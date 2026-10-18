import test from 'node:test';
import assert from 'node:assert/strict';
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

function fixture({lang = 'zh-Hans', stored = null} = {}) {
  const doc = new FakeDocument(lang), win = new FakeWindow(), storage = fakeStorage(stored === null ? {} : {[appearanceStorageKey]: stored});
  const trigger = new FakeElement('button', doc);
  trigger.setAttribute('id', 'site-theme');
  trigger.parentElement = doc.body;
  doc.trigger = trigger;
  doc.body.append(trigger);
  mountSiteAppearance(doc, {win, storage});
  const menu = trigger.parentElement.children.find(node => node.id === 'site-appearance-menu');
  const radios = {};
  const walk = node => {
    if (node.tagName === 'INPUT') radios[node.getAttribute('value')] = node;
    for (const child of node.children || []) walk(child);
  };
  walk(menu);
  return {doc, win, storage, trigger, menu, radios};
}

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
  assert.equal(legend.textContent, '页面外观');
  assert.deepEqual(Object.keys(radios).sort(), [...appearanceModes].sort());
  for (const value of appearanceModes) assert.equal(radios[value].getAttribute('type'), 'radio');
  assert.equal(radios['night'].checked, true, 'the current mode stays visible in the checked choice');
  assert.match(trigger.getAttribute('aria-label'), /页面外观：夜色/);
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

test('every public language labels the appearance selection', () => {
  const expectations = [
    ['en', 'Appearance', /Appearance: Paper/],
    ['zh-Hans', '页面外观', /页面外观：纸白/],
    ['zh-Hant', '頁面外觀', /頁面外觀：紙白/],
    ['ja', '外観', /外観：紙/]
  ];
  for (const [lang, legend, label] of expectations) {
    const {doc, trigger, menu, radios} = fixture({lang});
    assert.equal(menu.children[0].children[0].textContent, legend, lang);
    trigger.dispatch('click');
    radios['paper'].checked = true;
    radios['paper'].dispatch('change');
    assert.match(trigger.getAttribute('aria-label'), label, lang);
    assert.equal(doc.documentElement.dataset.siteTheme, 'paper', lang);
    for (const value of appearanceModes) {
      assert.equal(radios[value].parentElement.children[1].textContent.length > 0, true, lang + ' misses ' + value);
    }
  }
});
