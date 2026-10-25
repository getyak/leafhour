import test from 'node:test';
import assert from 'node:assert/strict';
import {readerWriteKind,compareReaderConsole} from '../tools/reader-verification-evidence.mjs';

test('browser evidence recognizes the actual domain write routes',()=>{
 for(const route of ['/api/reading-sessions','/api/library/books/gutenberg-alice/reading-sessions','/api/library/books/gutenberg-alice/reading-milestones','/api/library/books/gutenberg-alice/comments'])assert.equal(readerWriteKind(route),'reading-record',route);
 assert.equal(readerWriteKind('/api/library/books/gutenberg-alice/progress'),'progress');
 for(const route of ['/api/library/books/gutenberg-alice/companion/messages','/api/library/books/gutenberg-alice/chat','/api/library/books/gutenberg-alice/audio/prepare'])assert.equal(readerWriteKind(route),'model',route);
 assert.equal(readerWriteKind('/api/library/daily-reading/presence'),'presence');
});

test('console acceptance keeps known debt but reports a new real error',()=>{
 const baseline={engines:[{engine:'webkit',version:'26.6',errors:[{text:'Known http://127.0.0.1:1000/read'}]}]};
 const result=compareReaderConsole({baseline,engine:'webkit',version:'26.6',errors:[{text:'Known http://127.0.0.1:2000/read'},{text:'New exception'}]});
 assert.equal(result.verified,true);assert.deepEqual(result.newErrors,[{text:'New exception'}]);
});

test('missing or mismatched console provenance cannot report a verified clean run',()=>{
 assert.equal(compareReaderConsole({baseline:null,engine:'webkit',version:'26.6',errors:[]}).verified,false);
 assert.throws(()=>compareReaderConsole({baseline:{engines:[{engine:'webkit',version:'26.5',errors:[]}]},engine:'webkit',version:'26.6',errors:[]}),/baseline/i);
});

test('the same HTTP failure text on a different route is still a new error',()=>{
 const baseline={engines:[{engine:'chromium',version:'153',errors:[{path:'/api/billing/account',text:'Failed to load resource: 503'}]}]};
 const error={path:'/api/library/books/book/chat',text:'Failed to load resource: 503'};
 assert.deepEqual(compareReaderConsole({baseline,engine:'chromium',version:'153',errors:[error]}).newErrors,[error]);
});
