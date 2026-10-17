import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingReadingBackup} from '../app/reading-pending-backup.mjs';
import {validateLibraryBackup} from '../app/library-backup.mjs';
import {readingBook,focusSession} from './reading-fixtures.mjs';
test('a pending-only export can be imported normally and retains the latest terminal snapshot',()=>{const final=focusSession({sequence:3,status:'finished'}),backup=pendingReadingBackup(readingBook,[focusSession(),final]);assert.equal(validateLibraryBackup(backup).books,1);assert.equal(backup.books[0].records.readingSessions.length,1);assert.equal(backup.books[0].records.readingSessions[0].status,'finished');assert.equal(backup.books[0].book.sections[0].paragraphs[0].original,'Read this first.');assert.deepEqual(backup.books[0].records.comments,[]);});
test('pending records from another book cannot be exported under this source',()=>{assert.throws(()=>pendingReadingBackup(readingBook,[focusSession({bookId:'other'})]));});
test('pending exports hydrate a partial reading view and refuse a different or incomplete full source',async()=>{
 const {completeReadingBackupBook}=await import('../app/reading-pending-backup.mjs');const partial=structuredClone(readingBook);partial.reading={partial:true};partial.sections[0].paragraphs[0]={id:readingBook.sections[0].paragraphs[0].id,unloaded:true};
 const full=await completeReadingBackupBook(partial,async()=>readingBook),backup=pendingReadingBackup(full,[focusSession()]);assert.equal(validateLibraryBackup(backup).books,1);assert.equal(backup.books[0].book.sections[0].paragraphs[0].original,'Read this first.');assert.equal(partial.sections[0].paragraphs[0].unloaded,true);
 for(const invalid of [partial,{...readingBook,bookId:'other'},{...readingBook,contentVersion:'other'}])await assert.rejects(completeReadingBackupBook(partial,async()=>invalid),/完整原文/);await assert.rejects(completeReadingBackupBook(partial,async()=>{throw Error('offline');}),/offline/);
});
