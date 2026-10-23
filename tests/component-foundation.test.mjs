import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {transform} from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cssFile = name => readFile(path.join(root, 'app', name), 'utf8');
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '');

const hex = value => {
  if (value.length === 4) value = '#' + [...value.slice(1)].map(char => char + char).join('');
  return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
};
const channel = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a, b) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};
const mix = (a, b, weight) => a.map((value, index) => Math.round(value * weight + b[index] * (1 - weight)));

// Declarations of one selector; when a file repeats the selector in a dark
// media block, only that block's text is parsed so day/night stay separate.
function palette(source, selector, {media = false} = {}) {
  const darkBlocks = [];
  const spans = [];
  for (const match of source.matchAll(/@media[^{]*prefers-color-scheme:\s*dark[^{]*\{/g)) {
    let depth = 1, i = match.index + match[0].length;
    while (depth && i < source.length) { if (source[i] === '{') depth++; else if (source[i] === '}') depth--; i++; }
    darkBlocks.push(source.slice(match.index + match[0].length, i - 1));
    spans.push([match.index, i]);
  }
  // Day palettes parse outside dark blocks; night palettes parse inside them.
  let text = media ? darkBlocks.join('\n') : spans.reduceRight((acc, [start, end]) => acc.slice(0, start) + acc.slice(end), source);
  if (!text.trim()) return null;
  const values = {};
  // Read declarations for an exact member of a shared selector list; this
  // extracts palette constants, it does not simulate the browser cascade.
  for (const block of stripComments(text).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!block[1].split(',').some(member => member.trim() === selector)) continue;
    for (const match of block[2].matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{3}(?:[0-9a-f]{3})?|var\(--[a-z-]+\))/g)) values[match[1]] = match[2];
  }
  return Object.keys(values).length ? values : null;
}
// Palette aliases may point at surface-own tokens (the chat dock does).
const resolve = (values, name) => {
  const value = values[name];
  if (!value) return null;
  const alias = /^var\((--[a-z-]+)\)$/.exec(value);
  return alias ? hex(values[alias[1]] || '#000000') : hex(value);
};

test('palette extraction accepts shared selectors without confusing day and night', () => {
  const source = ':root,.preview{--paper:#fff;--ink:#222;--accent:#345} :root[data-site-theme=night],.preview-night{--paper:#111;--ink:#eee;--accent:#abc} @media(prefers-color-scheme:dark){:root{--paper:#123;--ink:#fed;--accent:#456}}';
  assert.deepEqual(palette(source, ':root'), {'--paper':'#fff','--ink':'#222','--accent':'#345'});
  assert.deepEqual(palette(source, '.preview'), palette(source, ':root'));
  assert.equal(palette(source, ':root[data-site-theme=night]')['--paper'], '#111');
  assert.equal(palette(source, ':root', {media:true})['--paper'], '#123');
  assert.equal(palette(source, '.missing'), null);
});

test('every product stylesheet parses cleanly through esbuild', async () => {
  const files = (await readdir(path.join(root, 'app'))).filter(name => name.endsWith('.css'));
  assert.ok(files.includes('interface-tokens.css'));
  for (const name of files) {
    const source = await cssFile(name);
    const result = await transform(source, {loader: 'css'});
    assert.ok(result.code.length > 0, name);
  }
});

test('the shared module owns the two line tokens, the shadow family and the focus ring', async () => {
  const css = await cssFile('interface-tokens.css');
  const tokens = [...css.matchAll(/(--[a-z-]+):/g)].map(match => match[1]);
  for (const token of ['--line-hairline', '--line-control', '--shadow-popover', '--shadow-modal', '--focus-ring', '--action-radius']) {
    assert.ok(tokens.includes(token), 'the interface module misses ' + token);
  }
  assert.equal(tokens.filter(token => token.startsWith('--line-')).length, 2, 'exactly two shared interface line tokens');
  assert.match(css, /--line-hairline:\s*color-mix\(in srgb, var\(--ink[^)]*\) 8%, transparent\)/);
  assert.match(css, /--line-control:\s*color-mix\(in srgb, var\(--line[^)]*\) 82%, var\(--accent[^)]*\)\)/);
  assert.match(css, /--shadow-popover:.*rgba\(31, 52, 38/);
  assert.match(css, /--shadow-modal:.*rgba\(31, 52, 38/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  // Derived tokens must resolve against the local palette of the focused
  // element, not only the document root: one formula, scoped per element.
  const derived = /:where\(\*\)\s*\{([^}]*)\}/.exec(css);
  assert.ok(derived, 'derived tokens must re-resolve per element');
  assert.match(derived[1], /--focus-ring:\s*color-mix\(in srgb, var\(--accent[^)]*\) 72%, var\(--ink[^)]*\)\)/);
  assert.match(derived[1], /--line-hairline:/);
  assert.doesNotMatch(derived[1], /--action-text:/, 'per-element defaults must not override inherited night action foregrounds');
  assert.match(css, /:where\(html\)\s*\{[^}]*--action-text:\s*var\(--paper/s);
});

test('the 72% accent focus ring keeps 3:1 contrast against every local palette', async () => {
  const module = await cssFile('interface-tokens.css');
  const formula = /--focus-ring:\s*color-mix\(in srgb, var\(--accent[^)]*\) (\d+)%, var\(--ink[^)]*\)\)/.exec(module);
  assert.ok(formula, 'the ring must be a documented accent/ink mix');
  const weight = Number(formula[1]) / 100;
  assert.ok(Math.abs(weight - 0.72) <= 0.02, 'the ring keeps the reviewed ~72% accent mix');
  const palettes = [
    ['portal.css', ':root', false, 'site paper', ['--paper', '--surface', '--surface-soft']],
    ['portal.css', ':root[data-site-theme=night]', false, 'site night', ['--paper', '--surface', '--surface-soft']],
    ['styles.css', ':root', false, 'reader paper', ['--paper', '--wash', '--panel']],
    ['styles.css', ':root[data-theme=night]', false, 'reader night', ['--paper', '--wash', '--panel']],
    ['styles.css', ':root[data-theme=warm]', false, 'reader warm', ['--paper', '--wash', '--panel']],
    ['styles.css', ':root[data-theme=mist]', false, 'reader mist', ['--paper', '--wash', '--panel']],
    ['styles.css', ':root[data-theme=leaf]', false, 'reader leaf', ['--paper', '--wash', '--panel']],
    ['book-gift.css', ':root', false, 'gift paper', ['--paper', '--sheet']],
    ['discovery.css', '.discovery-page', false, 'support day', ['--paper']],
    ['discovery.css', '.discovery-page', true, 'support night', ['--paper']],
    ['source-review.css', ':root', false, 'source review day', ['--paper']],
    ['source-review.css', ':root', true, 'source review night', ['--paper']],
    ['evals.css', ':root', false, 'evals day', ['--paper']],
    ['evals.css', ':root', true, 'evals night', ['--paper']],
    // The chat dock keeps its own palette, including dark while the page may
    // stay warm/mist/leaf: the ring must resolve against chat ink/accent.
    ['library-chat.css', 'chat-panel:#fff', false, 'chat light', ['--chat-panel', '--chat-soft']],
    ['library-chat.css', 'chat-panel:#242826', false, 'chat dark', ['--chat-panel', '--chat-soft']],
    ['auth.css', '.auth-dialog', false, 'auth day', ['--auth-paper', '--auth-field']],
    ['interaction-craft.css', ':root[data-site-theme=night] .auth-dialog', false, 'auth night', ['--auth-paper', '--auth-field']]
  ];
  for (const [file, selector, media, label, surfaces] of palettes) {
    const source = await cssFile(file);
    let values;
    if (selector.startsWith('chat-panel:')) {
      // The chat root keeps aliases in its base rule and re-colours --chat-*
      // in its dark rule; merge both the way the cascade does.
      const parseBlock = marker => {
        const at = source.indexOf('--' + marker);
        assert.ok(at >= 0, label + ' palette missing');
        const start = source.lastIndexOf('{', at) + 1, end = source.indexOf('}', at);
        const out = {};
        for (const match of source.slice(start, end).matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{3}(?:[0-9a-f]{3})?|var\(--[a-z-]+\))/g)) out[match[1]] = match[2];
        return out;
      };
      values = parseBlock('chat-panel:#fff');
      if (selector !== 'chat-panel:#fff') Object.assign(values, parseBlock(selector));
    } else if (label.startsWith('auth ')) {
      values = {...palette(await cssFile('auth.css'), '.auth-dialog'), ...palette(source, selector, {media})};
    } else {
      values = palette(source, selector, {media});
    }
    const accent = resolve(values, '--accent'), ink = resolve(values, '--ink');
    assert.ok(accent && ink, label + ' must declare accent and ink');
    const ring = mix(accent, ink, weight);
    const checked = [];
    for (const name of surfaces) {
      const surface = resolve(values, name);
      if (!surface) continue;
      const ratio = contrast(ring, surface);
      assert.ok(ratio >= 3, `${label} ${name}: ring contrast ${ratio.toFixed(2)}:1 fell below 3:1`);
      checked.push(name + '=' + ratio.toFixed(2) + ':1');
    }
    assert.ok(checked.length >= 1, label + ' must expose its adjacent surfaces');
  }
});

test('local palettes bind their own ink/accent so the one ring formula resolves locally', async () => {
  const chat = await cssFile('library-chat.css');
  assert.match(chat, /--ink:\s*var\(--chat-ink\);--accent:\s*var\(--chat-accent\);--paper:\s*var\(--chat-panel\);--line:\s*var\(--chat-line\)/,
    'the chat dock must alias its palette for the shared derivation');
  const support = await cssFile('discovery.css');
  assert.match(support, /\.discovery-page\{[^}]*--paper:#18251f;--ink:#e3eade;--line:#405244;--accent:#365b45/,
    'support night must alias its night palette');
  assert.match(support, /\.discovery-page\{[^}]*--ink:#263b32;--line:#d5ddd2;--accent:#365b45;--paper:#f7f5ef/,
    'support day must alias its day palette');
  for (const [file, day, night] of [['source-review.css', '--paper:#f6f5ef;--ink:#24352d', '--paper:#17221c;--ink:#e0e9de'], ['evals.css', '--paper:#faf9f5;--ink:#292c28', '--paper:#1b201d;--ink:#d9ded7']]) {
    const source = await cssFile(file);
    assert.ok(source.includes(day), file + ' misses its day palette');
    assert.ok(source.includes(night), file + ' misses its night palette');
  }
});

test('the input variant stays low-specificity and aria-invalid keeps its semantic border', async () => {
  const css = stripComments(await cssFile('interface-tokens.css'));
  const variant = /:where\(input:not\(\[type="radio"\]\):not\(\[type="checkbox"\]\):not\(\[type="range"\]\), textarea, select\)([^{]*)\{([^}]*)\}/g;
  const rules = [...css.matchAll(variant)];
  assert.ok(rules.length >= 2, 'the input variant must join the border and carry its halo');
  for (const [, tail, body] of rules) {
    assert.ok(!/not\(\[type/.test(tail.replace(/^:where/, '')), 'type exclusions belong inside :where()');
  }
  const borderRule = rules.find(([, tail]) => tail.includes('aria-invalid'));
  assert.ok(borderRule, 'the border join must exclude invalid fields');
  assert.match(borderRule[2], /border-color:\s*var\(--focus-ring\)/);
  const haloRule = rules.find(([, , body]) => body.includes('box-shadow'));
  assert.match(haloRule[2], /box-shadow:.*--focus-ring-halo/);
});

test('no surface re-implements the brand ring and keyboard focus is never removed', async () => {
  const files = (await readdir(path.join(root, 'app'))).filter(name => name.endsWith('.css'));
  // Documented wrappers show the ring around the field and silence the inner
  // input; programmatic container/heading focus keeps no frame of its own.
  const wrapperVariants = /sidebar-search|chat-composer|chat-dialog textarea/;
  const programmatic = /(^|[\s.#[])dialog\b|\bmain\b|#gift-title|\.book-page/;
  const ringSelector = /(^|[, >.~+])(button|a|summary|select|input|textarea|\.passage)([,: .{[>]|$)/;
  for (const name of files) {
    const source = stripComments(await cssFile(name));
    if (name === 'interface-tokens.css') continue;
    // No competing focus ring: focus-visible outlines may only use the shared
    // ring tokens, forced-colors Highlight, or none.
    for (const match of source.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)) {
      for (const outline of match[2].matchAll(/outline:\s*([^;}]+)/g)) {
        assert.match(outline[1], /^(?:none|0\b|var\(--focus-ring|[^;]*Highlight)/,
          name + ' declares a competing focus outline in ' + match[1].trim().slice(-60));
      }
    }
    for (const match of source.matchAll(/([^{}]+){[^}]*outline:\s*(?:none|0)\b/g)) {
      const selector = match[1].replace(/\s+/g, ' ').trim().split('}').pop();
      if (wrapperVariants.test(selector) || programmatic.test(selector)) continue;
      if (name === 'leafhour-surfaces.css' && selector === 'body.library-page .shelf-search input:focus-visible') {
        // A composite field may move the keyboard ring to its wrapper, but
        // only while that wrapper retains the shared visible ring and halo.
        assert.match(source, /\.shelf-search:has\(input:focus-visible\)\s*\{[^}]*outline:\s*var\(--focus-ring-width\) solid var\(--focus-ring\);[^}]*outline-offset:\s*var\(--focus-ring-offset\)/);
        assert.match(source, /\.shelf-search:focus-within\s*\{[^}]*border-color:\s*var\(--focus-ring\);[^}]*box-shadow:[^}]*var\(--focus-ring-halo\)/);
        continue;
      }
      assert.doesNotMatch(selector, ringSelector,
        name + ' removed keyboard focus indication from ' + selector);
    }
  }
});

test('the action vocabulary covers every primary class and the header sign-in', async () => {
  const css = await cssFile('interface-tokens.css');
  for (const cls of ['.primary', '.gift-primary', '.public-primary', '.reading-primary', '.share-primary', '.echo-submit', '.audio-primary', '.audio-secondary', '.outline', '.text-link']) {
    assert.ok(css.includes(cls), 'the vocabulary misses ' + cls);
  }
  assert.match(css, /#account-button:hover[^{]*{[^}]*background/);
  assert.match(css, /#account-button:active[^{]*{[^}]*background/);
  assert.match(css, /\.site-theme\[aria-expanded="true"\]/);
  // No source may keep a competing action radius for these classes.
  for (const name of await readdir(path.join(root, 'app'))) {
    if (!name.endsWith('.css') || name === 'interface-tokens.css') continue;
    const source = stripComments(await cssFile(name));
    for (const match of source.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = match[1].replace(/\s+/g, ' ').trim().split('}').pop();
      if (!/\.(?:primary|gift-primary|public-primary|reading-primary|share-primary|echo-submit|audio-primary|audio-secondary)\b|\.composer button\[type=submit\]|\.chapter-reading-actions button/.test(selector)) continue;
      assert.doesNotMatch(match[2], /border-radius:\s*(?!var\(--action-radius)/,
        name + ' keeps a competing action radius on ' + selector);
    }
  }
});

test('static dialogs declare native autofocus intent without tabindex', async () => {
  for (const name of ['home.html', 'index.html']) {
    const html = await readFile(path.join(root, 'app', name), 'utf8');
    const dialogs = [...html.matchAll(/<dialog\b[^>]*>/g)];
    assert.ok(dialogs.length >= 6, name + ' must keep its dialogs');
    for (const [dialog] of dialogs) {
      assert.match(dialog, /<dialog autofocus/, name + ' dialog without native initial focus: ' + dialog.slice(0, 60));
    }
    assert.doesNotMatch(html, /<dialog[^>]*tabindex/, name + ' must not add tabindex to dialogs');
  }
});

test('the technical tools load the shared module and keep no competing ring', async () => {
  for (const name of ['source-review.html', 'evals.html']) {
    const html = await readFile(path.join(root, 'app', name), 'utf8');
    assert.ok(html.includes('<link rel="stylesheet" href="/interface-tokens.css">'), name + ' misses the shared module');
  }
  const review = stripComments(await cssFile('source-review.css'));
  assert.doesNotMatch(review, /#[0-9a-f]{6};\s*outline-offset/, 'source-review keeps its old amber ring');
  assert.doesNotMatch(review, /button\.primary\{background/, 'source-review keeps its rectangular primary');
});

// Regression checks for real cascade failures found by independent review.
test('share primary cannot inherit a secondary-only hover wash or square radius', async () => {
  const source = stripComments(await cssFile('share.css'));
  for (const [, selector, body] of source.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/\.share-actions button(?:\s|:hover|$)/.test(selector.trim())) continue;
    assert.doesNotMatch(body, /background(?:-color)?:|color:|border-radius:/, 'generic share button paint must not override primary states');
  }
});
test('the chat composer exposes the shared ring when its textarea receives keyboard focus', async () => {
  const source = stripComments(await cssFile('library-chat.css'));
  const wrapper = /\.library-chat-composer:has\(textarea:focus-visible\)\{([^}]*)\}/.exec(source);
  assert.ok(wrapper, 'the inner outline reset requires a visible keyboard wrapper');
  assert.match(wrapper[1], /outline:var\(--focus-ring-width\) solid var\(--focus-ring\)/);
});

test('reader secondary hover uses its own night wash when no portal surface exists', async () => {
  const css = stripComments(await cssFile('interface-tokens.css'));
  const hover = /\.outline:hover[^{}]*\{([^}]*)\}/.exec(css);
  assert.ok(hover);
  assert.match(hover[1], /background:\s*var\(--surface, var\(--wash,/);
  const reader = await cssFile('styles.css');
  const night = palette(reader, ':root[data-theme=night]');
  assert.ok(contrast(hex(night['--ink']), hex(night['--wash'])) >= 4.5);
  const craft = stripComments(await cssFile('interaction-craft.css'));
  assert.doesNotMatch(craft, /\.audio-secondary\s*\{[^}]*background:/);
});
test('share feedback styling targets its actual sibling status element', async () => {
  const source = stripComments(await cssFile('share.css'));
  assert.match(source, /(?:^|})\.share-status\{[^}]*font-size:12px/);
  assert.doesNotMatch(source, /\.share-actions \.share-status/);
});


test('reader language chips keep normal text contrast on paper and night surfaces', async () => {
  const reader = await cssFile('styles.css');
  const settings = await cssFile('reader-settings.css');
  const choices = stripComments(await cssFile('choice-control.css'));
  const block = /\.choice-chip\s*\{([^}]*)\}/.exec(choices)[1];
  const paint = Object.fromEntries([...block.matchAll(/(?:^|;)\s*(background|color):([^;]+)/g)].map(m => [m[1], m[2].trim()]));
  const resolveColor = (value, tokens) => {
    if (value.startsWith('#')) return hex(value);
    const variable = /^var\((--[a-z-]+)(?:,\s*(#[0-9a-f]+))?\)$/.exec(value);
    assert.ok(variable, 'expected a local colour token');
    return resolveColor(tokens[variable[1]] || variable[2], tokens);
  };
  for (const theme of ['paper', 'night']) {
    const tokens = {...palette(reader, ':root'), ...(theme === 'night' ? palette(reader, ':root[data-theme=night]') : {}), ...palette(settings, '#reader-ui-language')};
    assert.ok(contrast(resolveColor(paint.color, tokens), resolveColor(paint.background, tokens)) >= 4.5, theme + ' language labels must remain readable');
  }
});
