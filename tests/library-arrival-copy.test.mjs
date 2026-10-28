import test from 'node:test';
import assert from 'node:assert/strict';
import {requestUiRoute} from '../app/ui-locale.mjs';
test('a short recap states total time without attributing omitted books\' minutes to named books',async()=>{
 const {formatLibraryArrival}=await import('../app/library-arrival.mjs');await requestUiRoute('zh-Hans');
 const result=formatLibraryArrival({timeZone:'UTC',yesterday:{durationSeconds:3720,sourceDurationSeconds:{reader_focus:3720},notes:1,questions:2,bookCount:3,books:[{title:{zh:'A'}},{title:{zh:'B'}},{title:{zh:'C'}}]},lastRead:{at:'2026-10-14T12:00:00Z',title:{zh:'C'},durationSeconds:3600}});
 assert.ok(result.length<=3);assert.match(result.join(' '),/62 分钟/);assert.doesNotMatch(result[0],/A|B|C/);assert.match(result.at(-1),/C/);
});
