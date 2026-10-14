import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingReadingBackup} from '../app/reading-pending-backup.mjs';
import {validateLibraryBackup} from '../app/library-backup.mjs';
import {readingBook,focusSession} from './reading-fixtures.mjs';
test('a pending-only export can be imported normally and retains the latest terminal snapshot',()=>{const final=focusSession({sequence:3,status:'finished'}),backup=pendingReadingBackup(readingBook,[focusSession(),final]);assert.equal(validateLibraryBackup(backup).books,1);assert.equal(backup.books[0].records.readingSessions.length,1);assert.equal(backup.books[0].records.readingSessions[0].status,'finished');assert.equal(backup.books[0].book.sections[0].paragraphs[0].original,'Read this first.');assert.deepEqual(backup.books[0].records.comments,[]);});
test('pending records from another book cannot be exported under this source',()=>{assert.throws(()=>pendingReadingBackup(readingBook,[focusSession({bookId:'other'})]));});
