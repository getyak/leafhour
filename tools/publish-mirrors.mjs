import {execFileSync,spawnSync} from 'node:child_process';
import {cp,mkdtemp,rm,writeFile,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {exportRelease} from './release-policy.mjs';

const source=process.cwd(),commit=process.env.GITHUB_SHA;
if(process.env.GITHUB_REPOSITORY!=='getyak/marginalia-reader-private-archive'||process.env.GITHUB_REF!=='refs/heads/main')throw Error('Only the authoritative main branch can publish');
const git=(args,cwd=source,env=process.env)=>execFileSync('git',args,{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const current=()=>git(['ls-remote','origin','refs/heads/main']).split(/\s/)[0]===commit;
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'published=false\n');
if(!current()){console.log('A newer main commit exists; leaving publication to its run.');process.exit(0);}
const staging=await mkdtemp(path.join(tmpdir(),'reader-publish-'));
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
try{
  const bundle=path.join(staging,'bundle');await exportRelease(source,bundle,{commit});
  const response=await fetch('https://api.github.com/meta',{headers:{'User-Agent':'reader-release'}});if(!response.ok)throw Error('Cannot verify GitHub SSH host keys');
  const meta=await response.json(),hosts=path.join(staging,'known_hosts');if(!meta.ssh_keys?.length)throw Error('Missing GitHub host keys');await writeFile(hosts,meta.ssh_keys.map(key=>'github.com '+key).join('\n')+'\n');
  const name=git(['show','-s','--format=%an',commit]),email=git(['show','-s','--format=%ae',commit]);
  for(const [repo,key] of [['getyak/marginalia-reader',process.env.PUBLIC_MIRROR_KEY_FILE],['cubxxw/marginalia-reader-deploy',process.env.DEPLOY_MIRROR_KEY_FILE]]){
    if(!key)throw Error('Missing repository-specific mirror key');
    if(!current()){console.log('A newer main commit superseded this publication.');break;}
    const target=path.join(staging,repo.split('/')[0]);
    const env={...process.env,GIT_SSH_COMMAND:'ssh -i '+quote(key)+' -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile='+quote(hosts)};
    git(['clone','--quiet','--depth=1','--branch','main','git@github.com:'+repo+'.git',target],source,env);
    git(['rm','-r','--quiet','--ignore-unmatch','.'],target,env);
    await cp(bundle,target,{recursive:true});
    git(['add','--all'],target,env);git(['config','user.name',name],target,env);git(['config','user.email',email],target,env);
    const changed=spawnSync('git',['diff','--cached','--quiet'],{cwd:target,env}).status;
    if(changed!==0&&changed!==1)throw Error('Cannot inspect staged release');
    // Re-running Publish also retries a failed Vercel build for the same source.
    if(changed===1||repo==='cubxxw/marginalia-reader-deploy'){git(['commit','--quiet','--allow-empty','-m','release: sync source '+commit],target,env);git(['push','origin','HEAD:main'],target,env);}
    console.log('Published '+repo+' at '+git(['rev-parse','HEAD'],target,env));
    if(repo==='cubxxw/marginalia-reader-deploy'&&process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'published=true\n');
  }
}finally{await rm(staging,{recursive:true,force:true});}
