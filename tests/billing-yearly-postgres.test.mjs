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
const fixture=new URL('./fixtures/billing-yearly-postgres.sql',import.meta.url);
const monthlyFixture=new URL('./fixtures/billing-subscriptions-postgres.sql',import.meta.url);
const annualMigration=new URL('../supabase/migrations/202610220001_yearly_reading_subscriptions.sql',import.meta.url);

test('isolated Postgres executes yearly grants and serializes monthly/yearly cross-process signup',async t=>{
  assert.ok(existsSync(migration));assert.ok(existsSync(fixture));
  const bin=postgresBin();
  assert.ok(existsSync(join(bin,'initdb')),'Native Postgres required for annual billing verification');
  const root=await mkdtemp(join(tmpdir(),'leafhour-subscriptions-sql-')),data=join(root,'data');
  const env={PATH:process.env.PATH,HOME:root,LC_ALL:'C'};
  const run=(name,args,input)=>spawnSync(join(bin,name),args,{env,encoding:'utf8',input,timeout:30000});let started=false;
  try{
    const init=run('initdb',['-D',data,'-A','trust','--no-locale','-E','UTF8']);
    assert.equal(init.status,0,init.stderr||init.stdout);
    const boot=run('pg_ctl',['-D',data,'-l',join(root,'server.log'),'-o',"-c listen_addresses='' -c unix_socket_directories='"+root+"'",'start']);
    assert.equal(boot.status,0,await readFile(join(root,'server.log'),'utf8').catch(()=>boot.stderr));
    started=true;
    const seed=`
select public.reader_billing_command('order','{"mode":"test","ownerId":"synthetic-history","id":"history-monthly","intentKey":"history","productKey":"reading_monthly_100","productId":"prod-history","amount":500,"currency":"USD","units":100000000}');
select public.reader_billing_command('trial','{"mode":"test","ownerId":"synthetic-history","grantId":"history-trial","units":10000000,"campaignBudgetUnits":10000000}');
create temp table history_orders as select to_jsonb(o) as value from public.billing_orders o;
create temp table history_entries as select to_jsonb(e) as value from public.billing_entries e;
`;
    const verifyHistory=`
do $$ begin
 if exists(select 1 from public.billing_orders o where o.id='history-monthly' and (o.billing_period is not null or not exists(select 1 from history_orders h where h.value=to_jsonb(o)-'billing_period'))) then raise exception 'historical monthly order changed'; end if;
 if (select jsonb_agg(value order by value::text) from history_entries) is distinct from (select jsonb_agg(to_jsonb(e) order by to_jsonb(e)::text) from public.billing_entries e) then raise exception 'historical ledger entries changed'; end if;
end; $$;
`;
    const applied=run('psql',['-h',root,'-d','postgres','-v','ON_ERROR_STOP=1','-X','-q'],"create role anon; create role authenticated; create role service_role bypassrls;\n"+await readFile(original,'utf8')+'\n'+await readFile(migration,'utf8')+'\n'+await readFile(monthlyFixture,'utf8')+'\n'+seed+'\n'+await readFile(annualMigration,'utf8')+'\n'+verifyHistory+'\n'+(await readFile(monthlyFixture,'utf8')).replace("value->>'schemaVersion'='2'","value->>'schemaVersion'='3'")+'\n'+await readFile(fixture,'utf8'));
    assert.equal(applied.status,0,applied.stderr||applied.stdout);assert.match(applied.stdout,/billing_yearly_sql_invariants_passed/);
    const race=index=>new Promise(resolve=>{const child=spawn(join(bin,'psql'),['-h',root,'-d','postgres','-v','ON_ERROR_STOP=1','-X','-Atc',`select public.reader_billing_command('order','{"mode":"test","ownerId":"synthetic-race","id":"race-${index}","intentKey":"intent-${index}","productKey":"${index===1?'reading_monthly_100':'reading_yearly_1200'}","productId":"product-${index}","amount":${index===1?500:5000},"currency":"USD","units":${index===1?100000000:1200000000},"billingPeriod":"${index===1?'every-month':'every-year'}"}');`],{env});let output='';child.stderr.on('data',chunk=>output+=chunk);child.on('error',error=>resolve({status:-1,output:error.message}));child.on('exit',status=>resolve({status,output}));});
    const results=await Promise.all([race(1),race(2)]);assert.equal(results.filter(x=>x.status===0).length,1,JSON.stringify(results));assert.match(results.find(x=>x.status!==0).output,/reader_billing:subscription_exists/);
  }finally{if(started)run('pg_ctl',['-D',data,'-m','immediate','stop']);await rm(root,{recursive:true,force:true});}
});
