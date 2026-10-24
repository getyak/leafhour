import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {postgresBin} from './helpers/postgres-bin.mjs';
const migration=new URL('../supabase/migrations/202610210002_reading_subscriptions.sql',import.meta.url);
const original=new URL('../supabase/migrations/202610210001_credit_billing.sql',import.meta.url);
const fixture=new URL('./fixtures/billing-subscriptions-postgres.sql',import.meta.url);

test('subscription migration extends the delivered schema and private transaction boundary',async()=>{
  const sql=await readFile(migration,'utf8');
  assert.match(sql,/alter function public\.reader_billing_command\(text,\s*jsonb\) rename to reader_billing_command_v1/i);
  assert.match(sql,/create table if not exists public\.billing_subscriptions\b/i);
  assert.match(sql,/alter table public\.billing_subscriptions enable row level security/i);
  assert.match(sql,/revoke all on public\.billing_subscriptions from public,anon,authenticated/i);
  assert.match(sql,/revoke all on function public\.reader_billing_command\(text,jsonb\).*from public,anon,authenticated/is);
  assert.match(sql,/grant execute on function public\.reader_billing_command\(text,jsonb\).*to service_role/is);
  assert.match(sql,/schemaVersion',2/);
  for(const command of ['bindSubscription','lookupSubscription','subscriptions','subscriptionState','subscriptionPaid','expireCheckout'])assert.ok(sql.includes("'"+command+"'"));
  assert.match(sql,/billing_orders_status_check check \(status in \('pending','paid','partially_refunded','refunded','disputed','expired'\)\)/);
  assert.match(sql,/billing_monthly_owner_active[^;]*status not in \('canceled'\)/);
  assert.match(sql,/billing_monthly_owner_active/);
  assert.match(sql,/billing_subscription_transaction/);
  assert.match(sql,/billing_subscription_period/);
  assert.ok(!/security definer/i.test(sql));
});

test('isolated Postgres executes subscription cycles, lifecycle and concurrent monthly signup',async t=>{
  assert.ok(existsSync(migration));assert.ok(existsSync(fixture));
  const bin=postgresBin();
  if(!existsSync(join(bin,'initdb'))){t.skip('isolated subscription SQL not executed: native Postgres unavailable');return;}
  const root=await mkdtemp(join(tmpdir(),'leafhour-subscriptions-sql-')),data=join(root,'data');
  const env={PATH:process.env.PATH,HOME:root,LC_ALL:'C'};
  const run=(name,args,input)=>spawnSync(join(bin,name),args,{env,encoding:'utf8',input,timeout:30000});let started=false;
  try{
    const init=run('initdb',['-D',data,'-A','trust','--no-locale','-E','UTF8']);
    if(init.status!==0){const message=(init.stderr||init.stdout||'').replaceAll(root,'<temporary cluster>');if(/Operation not permitted|Permission denied|cannot be run as root|could not create shared memory segment: No space left on device/.test(message)){t.skip('isolated subscription SQL not executed: '+message.trim().slice(-800));return;}assert.equal(init.status,0,message);}
    const boot=run('pg_ctl',['-D',data,'-l',join(root,'server.log'),'-o',"-c listen_addresses='' -c unix_socket_directories='"+root+"'",'start']);
    if(boot.status!==0){const message=await readFile(join(root,'server.log'),'utf8').catch(()=>boot.stderr);if(/Operation not permitted|Permission denied/.test(message)){t.skip('isolated subscription SQL not executed: '+message.slice(-800));return;}assert.equal(boot.status,0,message);}
    started=true;
    const applied=run('psql',['-h',root,'-d','postgres','-v','ON_ERROR_STOP=1','-X','-q'],"create role anon; create role authenticated; create role service_role bypassrls;\n"+await readFile(original,'utf8')+'\n'+await readFile(migration,'utf8')+'\n'+await readFile(fixture,'utf8'));
    assert.equal(applied.status,0,applied.stderr||applied.stdout);assert.match(applied.stdout,/billing_subscription_sql_invariants_passed/);
    // close waits for stderr to drain; exit can precede the final diagnostic data.
    const race=index=>new Promise(resolve=>{const child=spawn(join(bin,'psql'),['-h',root,'-d','postgres','-v','ON_ERROR_STOP=1','-X','-Atc',`select public.reader_billing_command('order','{"mode":"test","ownerId":"synthetic-race","id":"race-${index}","intentKey":"intent-${index}","productKey":"reading_monthly_100","productId":"product-monthly","amount":500,"currency":"USD","units":100000000}');`],{env});let output='';child.stderr.on('data',chunk=>output+=chunk);child.on('error',error=>resolve({status:-1,output:error.message}));child.on('close',status=>resolve({status,output}));});
    const results=await Promise.all([race(1),race(2)]);assert.equal(results.filter(x=>x.status===0).length,1,JSON.stringify(results));assert.match(results.find(x=>x.status!==0).output,/reader_billing:subscription_exists/);
  }finally{if(started)run('pg_ctl',['-D',data,'-m','immediate','stop']);await rm(root,{recursive:true,force:true});}
});
