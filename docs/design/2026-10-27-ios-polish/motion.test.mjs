import test from 'node:test';
import assert from 'node:assert/strict';
import * as motion from './prototype/motion.mjs';

const stops = [['full', 0], ['half', 315], ['closed', 770]];
const required = (name) => assert.equal(typeof motion[name], 'function', `${name} must be implemented`);

test('the same elapsed time gives the same spring position at 30 and 120 frames per second', () => {
  required('advanceSpring');
  function run(fps) {
    let frame = {position: 770, velocity: -900};
    for (let i = 0; i < fps / 2; i++) frame = motion.advanceSpring(frame, 315, 1 / fps);
    return frame;
  }
  const a = run(30), b = run(120);
  assert.ok(Math.abs(a.position - b.position) < 1e-7);
  assert.ok(Math.abs(a.velocity - b.velocity) < 1e-6);
});

test('retargeting keeps current position and momentum rather than jumping to the old destination', () => {
  required('advanceSpring');
  const current = {position: 150, velocity: -850};
  assert.deepEqual(motion.advanceSpring(current, 770, 0), current);
  const next = motion.advanceSpring(current, 770, 1 / 1000);
  assert.ok(next.position < current.position, 'the upward release momentum must initially continue');
  assert.ok(next.velocity < 0);
  assert.deepEqual(current, {position: 150, velocity: -850}, 'caller state remains owned by the page');
});

test('long frame intervals stay finite and the spring settles at its destination', () => {
  required('advanceSpring');
  const delayed = motion.advanceSpring({position: 770, velocity: 1800}, 0, 2);
  assert.ok(Number.isFinite(delayed.position) && Number.isFinite(delayed.velocity));
  assert.ok(Math.abs(delayed.position) < 1e-8 && Math.abs(delayed.velocity) < 1e-7);
});

test('inside bounds the sheet follows the finger exactly and outside bounds it resists progressively', () => {
  required('resistedPosition');
  assert.equal(motion.resistedPosition(123, 0, 770, 874), 123);
  const a = motion.resistedPosition(-100, 0, 770, 874);
  const b = motion.resistedPosition(-200, 0, 770, 874);
  assert.ok(a < 0 && a > -100);
  assert.ok(b < a && b > -200);
  assert.ok(Math.abs(b - a) < Math.abs(a));
  const bottom = motion.resistedPosition(970, 0, 770, 874);
  assert.ok(bottom > 770 && bottom < 970);
});

test('a fast flick lands using its projected direction while a slow release stays in the nearest detent', () => {
  required('nearestDetent');
  assert.equal(motion.nearestDetent(300, 0, stops), 'half');
  assert.equal(motion.nearestDetent(300, -1000, stops), 'full');
  assert.equal(motion.nearestDetent(300, 1000, stops), 'closed');
});
