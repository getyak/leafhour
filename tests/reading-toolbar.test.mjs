import test from 'node:test';
import assert from 'node:assert/strict';

import {createReadingToolbarState} from '../app/reading-toolbar.mjs';

test('reading tools start tucked away and return there after leaving them idle', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const toolbar = createReadingToolbarState();
  assert.equal(toolbar.expanded, false);
  toolbar.reveal();
  assert.equal(toolbar.expanded, true);
  t.mock.timers.tick(4999);
  assert.equal(toolbar.expanded, true);
  t.mock.timers.tick(1);
  assert.equal(toolbar.expanded, false);
});

test('pointer and keyboard holds independently protect controls from disappearing', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const toolbar = createReadingToolbarState();
  toolbar.reveal();
  toolbar.hold('pointer', true);
  toolbar.hold('keyboard', true);
  t.mock.timers.tick(10000);
  toolbar.hold('pointer', false);
  t.mock.timers.tick(10000);
  assert.equal(toolbar.expanded, true);
  toolbar.hold('keyboard', false);
  t.mock.timers.tick(5000);
  assert.equal(toolbar.expanded, false);
});

test('closing and reopening cancels the earlier disappearance timer', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const toolbar = createReadingToolbarState();
  toolbar.reveal();
  t.mock.timers.tick(4000);
  toolbar.conceal();
  toolbar.reveal();
  t.mock.timers.tick(1000);
  assert.equal(toolbar.expanded, true);
  t.mock.timers.tick(4000);
  assert.equal(toolbar.expanded, false);
});

test('a dialog holds the open tools but never opens tucked-away controls on its own', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const toolbar = createReadingToolbarState();
  toolbar.hold('dialog', true);
  assert.equal(toolbar.expanded, false);
  toolbar.reveal();
  t.mock.timers.tick(10000);
  assert.equal(toolbar.expanded, true);
  toolbar.conceal();
  toolbar.hold('dialog', false);
  t.mock.timers.tick(10000);
  assert.equal(toolbar.expanded, false);
});
