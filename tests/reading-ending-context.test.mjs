import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreReadingEnding} from '../app/reading-ending-context.mjs';
import {readingBook,focusSession} from './reading-fixtures.mjs';
test('a finished reading reopens its exact ending after refresh without beginning another clock',()=>{const ending=restoreReadingEnding(focusSession({status:'finished',durationSeconds:9999}),readingBook);assert.deepEqual(ending.anchor,{chapterId:'ch01',passageId:'p2'});assert.equal(ending.durationSeconds,360);assert.equal(ending.snapshot.id,'focus-1');});
test('a different source edition or an unfinished visit cannot become an ending context',()=>{assert.equal(restoreReadingEnding(focusSession(),readingBook),null);assert.equal(restoreReadingEnding(focusSession({status:'finished',bookId:'other'}),readingBook),null);assert.equal(restoreReadingEnding(focusSession({status:'finished',contentVersion:'old-edition'}),readingBook),null);});
