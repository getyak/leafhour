import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';

// Resolve the local engine on CI and developer machines without connection URLs.
export function postgresBin(env=process.env){
  const configured=env.LEAFHOUR_TEST_PG_BIN;
  if(configured)return configured;
  const discovered=spawnSync('pg_config',['--bindir'],{encoding:'utf8',env,timeout:5000});
  const candidates=[discovered.status===0?discovered.stdout.trim():null,'/opt/homebrew/Cellar/postgresql@14/14.15/bin'];
  return candidates.find(bin=>bin&&['initdb','pg_ctl','psql'].every(name=>existsSync(join(bin,name))))||'';
}
