import {homeLocale} from './home-locale.mjs';

// GET-185 explicit appearance selection. The header trigger opens a labelled
// popover of native radio choices (System / Paper / Night); the current mode is
// visible on the trigger and in the checked choice. The popover is non-modal:
// Escape and outside presses close it, keyboard focus moves freely (no trap),
// and Escape returns focus to the trigger. The stored compatibility key
// marginalia-portal-appearance is kept; null/unknown values recover to system
// and cross-tab storage updates (including storage resets) stay in sync.
export const appearanceModes = ['system', 'paper', 'night'];
export const appearanceStorageKey = 'marginalia-portal-appearance';

const copy = {
  en: {
    names: {system: 'System', paper: 'Paper', night: 'Night'},
    legend: 'Appearance',
    trigger: name => 'Appearance: ' + name + ' (change)'
  },
  'zh-Hans': {
    names: {system: '跟随系统', paper: '纸白', night: '夜色'},
    legend: '页面外观',
    trigger: name => '页面外观：' + name + '（更改）'
  },
  'zh-Hant': {
    names: {system: '跟隨系統', paper: '紙白', night: '夜色'},
    legend: '頁面外觀',
    trigger: name => '頁面外觀：' + name + '（更改）'
  },
  ja: {
    names: {system: 'システム', paper: '紙', night: '夜'},
    legend: '外観',
    trigger: name => '外観：' + name + '（変更）'
  }
};

const icons = {system: '◐', paper: '☀', night: '☾'};
let mode = 'system';
let active = null; // {doc, win, storage, control, menu, options, strings}

function readStored(storage) {
  try {
    const saved = storage?.getItem(appearanceStorageKey);
    return appearanceModes.includes(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

function persist(storage, value) {
  try { storage?.setItem(appearanceStorageKey, value); } catch { /* private mode keeps the choice in memory only */ }
}

export const getSiteAppearance = () => mode;

export function setSiteAppearance(next) {
  if (!appearanceModes.includes(next)) return false;
  mode = next;
  persist(active?.storage ?? fallbackStorage(), next);
  apply();
  return true;
}

function fallbackStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

function emit(name, detail) {
  const Event = active?.win?.CustomEvent || globalThis.CustomEvent;
  if (!active?.doc?.dispatchEvent || typeof Event !== 'function') return;
  active.doc.dispatchEvent(new Event(name, {detail}));
}

function apply() {
  if (!active) return;
  const {doc, control, options, strings} = active;
  doc.documentElement.dataset.siteTheme = mode;
  if (control) {
    const label = strings.trigger(strings.names[mode]);
    control.setAttribute('aria-label', label);
    control.title = strings.names[mode];
    control.textContent = icons[mode];
  }
  for (const [value, input] of options) input.checked = value === mode;
  emit('site:appearance', mode);
}

function openMenu({focus = false} = {}) {
  const {win, control, menu} = active;
  menu.hidden = false;
  control.setAttribute('aria-expanded', 'true');
  if (control.getBoundingClientRect && menu.style) {
    const rect = control.getBoundingClientRect();
    const width = menu.offsetWidth || 210;
    const left = Math.max(8, Math.min(rect.left, (win.innerWidth || rect.right) - width - 8));
    menu.style.left = left + 'px';
    menu.style.top = (rect.bottom + 8) + 'px';
  }
  if (focus) {
    const checked = [...active.options.values()].find(input => input.checked) || active.options.get('system');
    checked?.focus?.();
  }
  emit('site:appearance-menu', 'open');
}

function closeMenu({restoreFocus = false} = {}) {
  const {control, menu} = active;
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  control.setAttribute('aria-expanded', 'false');
  if (restoreFocus) control.focus?.();
  emit('site:appearance-menu', 'close');
}

export function mountSiteAppearance(doc, options = {}) {
  const win = options.win || doc.defaultView || globalThis;
  const storage = options.storage || (function () { try { return win.localStorage; } catch { return null; } })();
  const strings = copy[homeLocale(doc)] || copy.en;
  const control = doc.getElementById?.('site-theme') || null;
  mode = readStored(storage);
  const menu = control ? doc.createElement('div') : null;
  const radios = new Map();
  if (menu) {
    menu.className = 'appearance-menu';
    menu.id = 'site-appearance-menu';
    menu.hidden = true;
    const group = doc.createElement('fieldset');
    group.className = 'appearance-options';
    const legend = doc.createElement('legend');
    legend.className = 'appearance-legend';
    legend.textContent = strings.legend;
    group.append(legend);
    for (const value of appearanceModes) {
      const label = doc.createElement('label');
      label.className = 'appearance-option';
      const input = doc.createElement('input');
      input.setAttribute('type', 'radio');
      input.setAttribute('name', 'site-appearance-menu');
      input.setAttribute('value', value);
      input.checked = value === mode;
      const name = doc.createElement('span');
      name.textContent = strings.names[value];
      label.append(input, name);
      input.addEventListener('change', () => { if (input.checked) setSiteAppearance(value); });
      radios.set(value, input);
      group.append(label);
    }
    menu.append(group);
    if (typeof control.after === 'function') control.after(menu);
    else control.parentElement?.appendChild(menu);
  }
  active = {doc, win, storage, control, menu, options: radios, strings};
  if (control) {
    control.setAttribute('aria-haspopup', 'true');
    control.setAttribute('aria-controls', 'site-appearance-menu');
    control.setAttribute('aria-expanded', 'false');
    control.addEventListener('click', () => {
      if (menu.hidden) openMenu();
      else closeMenu();
    });
    control.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (menu.hidden) openMenu({focus: true});
      }
    });
    // Outside presses close the popover without moving focus. Focus leaving the
    // whole trigger/menu pair closes it too, while trigger <-> choice moves stay
    // open. Tab is never captured, so this is no trap.
    doc.addEventListener('pointerdown', event => {
      const target = event.target;
      if (menu.hidden || menu.contains?.(target) || control.contains?.(target) || target === control) return;
      closeMenu();
    });
    doc.addEventListener('focusin', event => {
      const target = event.target;
      if (menu.hidden || menu.contains?.(target) || control.contains?.(target) || target === control) return;
      closeMenu();
    });
    // One document-level Escape path closes from anywhere and returns focus to
    // the trigger; closeMenu is idempotent so no duplicate close events fire.
    doc.addEventListener('keydown', event => {
      if (menu.hidden || event.key !== 'Escape') return;
      event.preventDefault();
      closeMenu({restoreFocus: true});
    });
  }
  win.addEventListener?.('storage', event => {
    // A storage reset (clear/removeItem) reports a null key or null value and
    // falls back to system; unknown cross-tab values recover the same way.
    if (event.key !== null && event.key !== appearanceStorageKey) return;
    const value = event.key === null ? null : event.newValue;
    const next = appearanceModes.includes(value) ? value : 'system';
    if (next === mode) return;
    mode = next;
    apply();
  });
  apply();
  return {get: getSiteAppearance, set: setSiteAppearance, open: () => control && openMenu(), close: closeMenu};
}

if (typeof document !== 'undefined') mountSiteAppearance(document);
