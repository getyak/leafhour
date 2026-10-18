import test from 'node:test';
import assert from 'node:assert/strict';
import {runDailyHost} from '../tools/daily-reading-host.mjs';
const config={version:1,serviceUrl:'https://leafhour.com',token:'synthetic_'.padEnd(43,'x'),hostInstallId:'host-install-00000001',hostLabel:'Codex',schedulerId:'heartbeat-0001'};
test('host CLI maps connect, explicit claim and fenced finish to the three narrow tools only',async()=>{
 const calls=[],read=async file=>file==='/private/config.json'?config:{eventId:'event-1',claimNonce:'claim-nonce-00000001',kind:'silence'},call=async args=>{calls.push(args);return {status:'quiet'};};
 for(const args of [['connect'],['claim','--event','test-1'],['finish','--input','/private/finish.json']])await runDailyHost(['--config','/private/config.json',...args],{read,call});
 assert.equal(calls[0].toolName,'reader_daily_connect');assert.deepEqual(calls[0].args,{hostInstallId:config.hostInstallId,hostLabel:'Codex',schedulerId:config.schedulerId});
 assert.deepEqual(calls[1].args,{hostInstallId:config.hostInstallId,eventId:'test-1'});assert.equal(calls[2].args.claimNonce,'claim-nonce-00000001');assert.equal(calls[2].args.hostInstallId,config.hostInstallId);
});
test('CLI rejects ambiguous arguments, token flags and malformed or unfenced finish input before a child starts',async()=>{
 let calls=0;const call=async()=>{calls++;},read=async file=>file.endsWith('config.json')?config:{eventId:'event-1',kind:'message',message:'x'};
 for(const args of [[],['--config','/a','--token','secret','claim'],['--config','/a','claim','claim'],['--config','/a','claim','--event','one','--event','two'],['--config','/private/config.json','finish','--input','/private/input.json']])await assert.rejects(runDailyHost(args,{read,call}),e=>!e.message.includes('secret'));
 assert.equal(calls,0);
});
test('connect needs an actual scheduler reference and finish cannot replace the configured host identity',async()=>{
 const call=()=>assert.fail('invalid config/input cannot create a child');
 await assert.rejects(runDailyHost(['--config','/config','connect'],{read:async()=>({...config,schedulerId:''}),call}));
 await assert.rejects(runDailyHost(['--config','/config','finish','--input','/input'],{read:async file=>file==='/config'?config:{eventId:'e',claimNonce:'claim-nonce-00000001',kind:'silence',hostInstallId:'different'},call}));
});
test('every option requires an explicit nonempty value and missing test ID never falls back to a scheduled claim',async()=>{
 let calls=0;const read=async()=>config,call=async()=>{calls++;return {status:'claimed'};};
 for(const suffix of [['--event'],['--input'],['--event',''],['--event','--input','/private/result.json'],['--config']])await assert.rejects(runDailyHost(['--config','/private/config.json','claim',...suffix],{read,call}));
 assert.equal(calls,0);
});
