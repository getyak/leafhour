import test from 'node:test';
import assert from 'node:assert/strict';
import { routeOf } from '../api/[...path].js';

test('Vercel route uses catch-all query when available', () => {
  assert.equal(routeOf({ query: { path: ['records', 'export'] }, url: '/api/ignored' }), '/api/records/export');
});

test('Vercel route falls back to the request URL', () => {
  assert.equal(routeOf({ query: {}, url: '/api/book?source=reader' }), '/api/book');
});
