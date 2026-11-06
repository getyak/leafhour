import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {postgresBin} from './helpers/postgres-bin.mjs';
import {processResult} from './helpers/process-result.mjs';

// Native, disposable SQL verifies the actual transaction and privileges. No
// configured database URL, private identity or application data is consulted.
test('isolated Postgres commits one fenced domain delivery and rejects revoked or competing publications',async t=>{
 const bin=postgresBin();
 if(!existsSync(join(bin,'initdb'))&&process.env.LEAFHOUR_HOSTED_BUILD_TESTS==='1'){t.skip('native PostgreSQL unavailable in hosted build; SQL verification runs in CI');return;}
 assert.ok(existsSync(join(bin,'initdb')),'Native Postgres required for execution delivery verification');
 const root=await mkdtemp(join(tmpdir(),'leafhour-delivery-sql-')),data=join(root,'data'),env={PATH:process.env.PATH,LC_ALL:'C'};
 const run=(name,args,input)=>spawnSync(join(bin,name),args,{env,encoding:'utf8',input,timeout:30000});
 const sql=input=>run('psql',['-h',root,'-d','postgres','-v','ON_ERROR_STOP=1','-X','-Atq'],input);
 const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
 const call=(n,key,version=0)=>`select public.reader_document_cas_delivery('${key}',${version},'{"answer":"synthetic result"}','${uuid(n)}','${'a'.repeat(64)}','synthetic-owner','${'b'.repeat(64)}');`;
 const candidate=n=>({id:uuid(n),status:'candidate_ready',ownerId:'synthetic-owner',commitReceiptId:'a'.repeat(64),resultDigest:'b'.repeat(64),events:[]});
 let started=false;
 try{
  const initialized=run('initdb',['-D',data,'-A','trust','--no-locale','-E','UTF8']);assert.equal(initialized.status,0,initialized.stderr);
  const boot=run('pg_ctl',['-D',data,'-l',join(root,'server.log'),'-o',"-c listen_addresses='' -c unix_socket_directories='"+root+"'",'start']);assert.equal(boot.status,0,await readFile(join(root,'server.log'),'utf8').catch(()=>boot.stderr));started=true;
  const original=(await readFile(new URL('../supabase/migrations/202610130001_hosted_library.sql',import.meta.url),'utf8')).split('insert into storage.buckets')[0]+'commit;';
  const migration=await readFile(new URL('../supabase/migrations/202611050001_execution_deliveries.sql',import.meta.url),'utf8');
  const seed=`create role anon;create role authenticated;create role service_role bypassrls;\n${original}\n${migration}\nselect public.reader_document_cas('execution/queue/v1',0,'${JSON.stringify({jobs:[candidate(1)]})}');`;
  const applied=sql(seed);assert.equal(applied.status,0,applied.stderr);
  const delivered=sql('set role service_role;'+call(1,'domain-result'));assert.equal(delivered.status,0,delivered.stderr);assert.equal(delivered.stdout.trim(),'t');
  const replay=sql('set role service_role;'+call(1,'domain-result'));assert.equal(replay.status,0,replay.stderr);assert.equal(replay.stdout.trim(),'t');
  const state=sql("select (select version from public.reader_documents where key='domain-result'),(select count(*) from public.reader_execution_deliveries),value->'jobs'->0->>'status',jsonb_array_length(value->'jobs'->0->'events') from public.reader_documents where key='execution/queue/v1';");
  assert.equal(state.status,0,state.stderr);assert.equal(state.stdout.trim(),'1|1|succeeded|1');
  const denied=sql('set role authenticated;'+call(1,'domain-result'));assert.notEqual(denied.status,0);assert.match(denied.stderr,/permission denied/);
  const conflicting=sql(call(1,'different-domain'));assert.notEqual(conflicting.status,0);assert.match(conflicting.stderr,/execution receipt conflict/);
  const revoked=sql("update public.reader_documents set value='"+JSON.stringify({jobs:[{...candidate(2),status:'cancelled'}]})+"' where key='execution/queue/v1';"+call(2,'cancelled-domain'));
  assert.notEqual(revoked.status,0);assert.match(revoked.stderr,/execution candidate revoked/);
  const prepare=sql("update public.reader_documents set value='"+JSON.stringify({jobs:[{...candidate(3),commitReceiptId:'c'.repeat(64)}]})+"' where key='execution/queue/v1';");assert.equal(prepare.status,0,prepare.stderr);
  const race=key=>processResult(spawn(join(bin,'psql'),['-h',root,'-d','postgres','-v','ON_ERROR_STOP=1','-X','-Atqc',call(3,key).replace('a'.repeat(64),'c'.repeat(64))],{env}));
  const raced=await Promise.all([race('race-a'),race('race-b')]);assert.equal(raced.filter(r=>r.status===0).length,1,JSON.stringify(raced));assert.match(raced.find(r=>r.status!==0).output,/execution receipt conflict/);
  const count=sql("select count(*) from public.reader_documents where key in ('race-a','race-b');");assert.equal(count.status,0,count.stderr);assert.equal(count.stdout.trim(),'1');
 }finally{if(started)run('pg_ctl',['-D',data,'-m','immediate','stop']);await rm(root,{recursive:true,force:true});}
});
