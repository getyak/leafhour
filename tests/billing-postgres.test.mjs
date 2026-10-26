import {processResult} from './helpers/process-result.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {postgresBin} from './helpers/postgres-bin.mjs';

const adapterUrl=new URL('../deploy/billing-store.mjs',import.meta.url);
const migrationUrl=new URL('../supabase/migrations/202610210001_credit_billing.sql',import.meta.url);
const fixtureUrl=new URL('./fixtures/billing-postgres.sql',import.meta.url);
const env={SUPABASE_URL:'https://billing.example.supabase.co',SUPABASE_SECRET_KEY:'test-only-service-key'};
async function adapter(){
  assert.ok(existsSync(adapterUrl),'The durable billing RPC adapter must exist');
  const module=await import(adapterUrl);return module.createBillingPostgresStore;
}

test('billing adapter sends only the typed command through the service RPC',async()=>{
  const create=await adapter();let request;
  const store=create({env,fetcher:async(url,options)=>{request={url,options};return Response.json({availableUnits:17});}});
  assert.equal(store.durable,true);
  assert.deepEqual(await store.command('account',{mode:'test',ownerId:'owner-a'}),{availableUnits:17});
  assert.equal(request.url,env.SUPABASE_URL+'/rest/v1/rpc/reader_billing_command');
  assert.equal(request.options.method,'POST');
  assert.equal(request.options.headers.apikey,env.SUPABASE_SECRET_KEY);
  assert.deepEqual(JSON.parse(request.options.body),{command_name:'account',command_payload:{mode:'test',ownerId:'owner-a'}});
  assert.ok(request.options.signal instanceof AbortSignal);
});

test('billing adapter preserves consistent operation lookup and confirmed absence',async()=>{
  const create=await adapter();let request;
  const store=create({env,fetcher:async(_url,options)=>{request=JSON.parse(options.body);return Response.json(null);}});
  const payload={mode:'test',ownerId:'owner-a',operationId:'operation-not-started',consistent:true};
  assert.equal(await store.command('operation',payload),null);
  assert.deepEqual(request,{command_name:'operation',command_payload:payload});
});

test('billing adapter refuses missing configuration and invalid commands before a request',async()=>{
  const create=await adapter();let requests=0;
  assert.throws(()=>create({env:{}}),e=>e.status===503&&e.code==='billing_unavailable');
  assert.throws(()=>create({env:{...env,SUPABASE_URL:'http://localhost:5432'}}),e=>e.status===503);
  const store=create({env,fetcher:async()=>{requests++;return Response.json({});}});
  await assert.rejects(store.command('arbitrary_sql',{mode:'test'}),e=>e.status===400&&e.code==='invalid_input');
  await assert.rejects(store.command('account',{mode:'other',ownerId:'a'}),e=>e.status===400);
  await assert.rejects(store.command('account',{mode:'test'}),e=>e.status===400);
  assert.equal(requests,0);
});

test('billing adapter maps only recognized business errors and never leaks database details',async()=>{
  const create=await adapter();
  for(const [code,status]of [['insufficient_credits',402],['stale_quote',409],['idempotency_conflict',409],['owner_mismatch',403],['not_found',404],['invalid_input',400],['frozen_account',403],['invalid_state',409]]){
    const store=create({env,fetcher:async()=>Response.json({code:'P0001',message:'reader_billing:'+code,details:'secret reading content'},{status:400})});
    await assert.rejects(store.command('account',{mode:'test',ownerId:'a'}),e=>e.status===status&&e.code===code&&!e.message.includes('secret'));
  }
  for(const response of [Response.json({message:'reader_billing:insufficient_credits; password=bad'},{status:500}),Response.json({message:'relation private.content not found'},{status:404})]){
    const store=create({env,fetcher:async()=>response});
    await assert.rejects(store.command('account',{mode:'test',ownerId:'a'}),e=>e.status===503&&e.code==='billing_unavailable'&&!/password|private\.content/.test(e.message));
  }
});

test('billing adapter retries serialization/deadlock failures but never ambiguous network failures',async()=>{
  const create=await adapter();let attempts=0;
  const store=create({env,fetcher:async()=>++attempts<3?Response.json({code:'40001'},{status:409}):Response.json({id:'same-operation'})});
  assert.deepEqual(await store.command('settle',{mode:'test',ownerId:'a',operationId:'o',reservationToken:'t'}),{id:'same-operation'});
  assert.equal(attempts,3);
  attempts=0;const unavailable=create({env,fetcher:async()=>{attempts++;throw Error('private network token');}});
  await assert.rejects(unavailable.command('account',{mode:'test',ownerId:'a'}),e=>e.status===503&&e.code==='billing_unavailable'&&!e.message.includes('private'));
  assert.equal(attempts,1);
});

test('billing migration defines relational transactions and service-only privileges',async()=>{
  assert.ok(existsSync(migrationUrl),'The credit billing migration must exist');
  const sql=await readFile(migrationUrl,'utf8');
  for(const table of ['accounts','orders','credit_lots','entries','operations','quotes','webhook_inbox','provider_calls','outbox','allocations','refunds']){
    assert.match(sql,new RegExp('create table if not exists public\\.billing_'+table+'\\b','i'));
    assert.match(sql,new RegExp('alter table public\\.billing_'+table+' enable row level security','i'));
  }
  assert.match(sql,/for update/i);
  assert.match(sql,/reader_billing_command\(command_name text, command_payload jsonb\)/i);
  assert.match(sql,/revoke all on function public\.reader_billing_command\(text, jsonb\) from public, anon, authenticated/i);
  assert.match(sql,/grant execute on function public\.reader_billing_command\(text, jsonb\) to service_role/i);
  assert.match(sql,/before update or delete on public\.billing_entries/i);
  assert.ok(!/security definer/i.test(sql),'RPC should use the service role privilege boundary rather than definer escalation');
});

test('billing migration preserves canonical pricing and immutable source reporting facts',async()=>{
  const sql=await readFile(migrationUrl,'utf8');
  assert.match(sql,/command_payload->>'pricingVersion'/,'Supplier price version must survive the durable write');
  assert.match(sql,/source_units jsonb/,'Consume and reversal facts must retain immutable per-source units');
  assert.ok(sql.includes('restored_units bigint'),'A full consumption reversal must separate restored balance units');
  for(const field of ['callsByFunding','callsByFeature','grantedUnitsBySource','consumedUnitsBySource','reviewOrders','trialGrants','operationCounts','paymentFeesStatus','costCoverage'])assert.ok(sql.includes("'"+field+"'"),'Missing durable summary field '+field);
  assert.match(sql,/operation_row.status is distinct from command_payload->>'expectedStatus'/,'Recovery release must compare the state under its row lock');
});

test('consistent SQL operation reads lock the owner account before checking absence',async()=>{
  const sql=await readFile(migrationUrl,'utf8');
  const branch=sql.slice(sql.indexOf("if command_name='operation' then"),sql.indexOf("item_id=public.reader_billing_text(command_payload->'orderId');",sql.indexOf("if command_name='operation' then")));
  assert.ok(branch.includes("command_payload->'consistent'='true'::jsonb"),'Consistent operation reads must honor the explicit boolean');
  assert.match(branch,/perform 1 from public\.billing_accounts where mode=ledger_mode and owner_id=account_owner for update;/,'Read uses the same owner and environment account lock as reserve');
  assert.ok(branch.indexOf('for update;')<branch.indexOf('select * into operation_row'),'Lock must precede the operation lookup');
  assert.ok(!branch.includes('insert into'),'A consistent read must not create an account');
});

// This test initializes only a disposable cluster and never uses connection env
// variables. A missing/restricted native engine is reported as an explicit skip.
test('isolated Postgres executes billing invariants and concurrent reservation fixture',async t=>{
  assert.ok(existsSync(migrationUrl),'The credit billing migration must exist');
  assert.ok(existsSync(fixtureUrl),'The executable SQL invariant fixture must exist');
  const candidate=postgresBin();
  if(!existsSync(join(candidate,'initdb'))){t.skip('isolated SQL not executed: local Postgres binaries unavailable');return;}
  const root=await mkdtemp(join(tmpdir(),'leafhour-billing-sql-')),data=join(root,'data');
  const run=(name,args,input)=>spawnSync(join(candidate,name),args,{encoding:'utf8',input,timeout:30000,env:{PATH:process.env.PATH,HOME:root,LC_ALL:'C'}});
  let started=false;
  try{
    const initialized=run('initdb',['-D',data,'-A','trust','--no-locale','-E','UTF8']);
    if(initialized.status!==0){
      const details=(initialized.stderr||initialized.stdout||'').replaceAll(root,'<temporary cluster>');
      if(/Operation not permitted|Permission denied|cannot be run as root/.test(details)){t.skip('isolated SQL not executed: '+details.trim().slice(-900));return;}
      assert.equal(initialized.status,0,details);
    }
    const boot=run('pg_ctl',['-D',data,'-l',join(root,'server.log'),'-o',"-c listen_addresses='' -c unix_socket_directories='"+root+"'",'start']);
    if(boot.status!==0){
      const log=await readFile(join(root,'server.log'),'utf8').catch(()=>boot.stderr);
      if(/Operation not permitted|Permission denied/.test(log)){t.skip('isolated SQL not executed: Unix-only Postgres startup denied: '+log.slice(-900));return;}
      assert.equal(boot.status,0,log);
    }
    started=true;
    const sql=await readFile(migrationUrl,'utf8'),fixture=await readFile(fixtureUrl,'utf8');
    const applied=run('psql',['-h',root,'-d','postgres','-v','ON_ERROR_STOP=1','-X','-q'],"create role anon; create role authenticated; create role service_role bypassrls;\n"+sql+'\n'+fixture);
    assert.equal(applied.status,0,applied.stderr||applied.stdout);
    assert.match(applied.stdout,/billing_sql_invariants_passed/);
    // Account row locks serialize distinct processes that race for one balance.
    const prep=run('psql',['-h',root,'-d','postgres','-v','ON_ERROR_STOP=1','-X','-q'],`select public.reader_billing_command('trial','{"mode":"test","ownerId":"race","grantId":"race-trial","units":10,"campaignBudgetUnits":1000}');
      select public.reader_billing_command('quote','{"mode":"test","ownerId":"race","id":"race-q1","action":"translation","units":7,"scopeHash":"same","scope":{},"priceVersion":"v1","expiresAt":"2099-01-01"}');
      select public.reader_billing_command('quote','{"mode":"test","ownerId":"race","id":"race-q2","action":"translation","units":7,"scopeHash":"same","scope":{},"priceVersion":"v1","expiresAt":"2099-01-01"}');`);
    assert.equal(prep.status,0,prep.stderr);
    const {spawn}=await import('node:child_process');
    const reserve=index=>{
      const child=spawn(join(candidate,'psql'),['-h',root,'-d','postgres','-v','ON_ERROR_STOP=1','-X','-Atc',`select public.reader_billing_command('reserve','{"mode":"test","ownerId":"race","quoteId":"race-q${index}","operationId":"race-o${index}","idempotencyKey":"race-k${index}","scopeHash":"same"}');`],{env:{PATH:process.env.PATH,HOME:root,LC_ALL:'C'}});
      return processResult(child);
    };
    const raced=await Promise.all([reserve(1),reserve(2)]);
    assert.equal(raced.filter(result=>result.status===0).length,1,JSON.stringify(raced));
    assert.match(raced.find(result=>result.status!==0).output,/reader_billing:insufficient_credits/);
  }finally{
    if(started)run('pg_ctl',['-D',data,'-m','immediate','stop']);
    await rm(root,{recursive:true,force:true});
  }
});
