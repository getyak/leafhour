#!/usr/bin/env python3
"""Dormant, unsigned GET-328 hosted-only stages. No native calls at import time."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shutil
import signal
import struct
import stat
import subprocess
import sys
import time

SOURCE_SHA = '3869043f6a5cb492ee1a777d9a247d1df7d71041'
SOURCE_TREE = '396d83fe5a8231cc14b0a76ff4348ceb2aeb71a9'
APP_ID = 'org.leafhour.get328.acceptance20261107'
RUNNER_ID = APP_ID + '.uitests.xctrunner'
DEVELOPER = '/Applications/Xcode_26.6.app/Contents/Developer'
FIXTURE_MANIFEST_SHA = '3a6bbeadafabc6738934d51a376567ff9fb128dbed71a096d31be798803123de'
PDF_SHA = '0e5810fe2dfe46470a388382d3a0149a42bf36e54df354980a312f05483650b9'
GIB = 1024**3
CASE_METHODS = [
 'VideoExperienceUITests/test38SavedRecordsAndExpandedSettingsPassNativeAccessibilityAudits()',
 'VideoExperienceUITests/test41SystemTypeProfileKeepsTheRealTypographyPreviewAndResetUsable()',
 'VideoExperienceUITests/test54PagedNativeCopyAndReflowKeepTheVisibleSourceParagraph()',
]
CASES = [(f'normal-{n}', 'large', method) for n,method in zip((38,41,54),CASE_METHODS)] + [
 (f'ax5-{n}', 'accessibility-extra-extra-extra-large', method) for n,method in zip((38,41,54),CASE_METHODS)] + [
 ('pdf73','large','ReadingUITests/testPDFSystemImportAndLastPage()')]
CANCELLED = False

class SafetyError(RuntimeError): pass

def require(condition, reason):
    if not condition: raise SafetyError(reason)

def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Receipts are immutable, including failure receipts; no silent rerun.
    with path.open('x') as f: json.dump(data, f, indent=2); f.write('\n')

def sha(path,deadline=None):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):
            require(deadline is None or time.monotonic()<deadline,'hash deadline exceeded')
            h.update(block)
    return h.hexdigest()

def require_host(env, system=None, machine=None):
    require((system or platform.system())=='Darwin' and (machine or platform.machine())=='x86_64'
            and env.get('GITHUB_ACTIONS')=='true' and env.get('RUNNER_ENVIRONMENT')=='github-hosted'
            and env.get('RUNNER_ARCH')=='X64', 'requires standard Intel GitHub hosted runner')
    require(env.get('DEVELOPER_DIR')==DEVELOPER, 'wrong explicit Xcode')

class Budget:
    def __init__(self, state, clock=time.monotonic):
        self.clock=clock
        self.start=state.get('started_monotonic',state.get('monotonic_start'))
        self.end=state.get('deadline_monotonic',state.get('monotonic_deadline'))
        require(isinstance(self.start,(int,float)) and isinstance(self.end,(int,float))
                and self.end-self.start==4200 and self.start<=clock()<self.end, 'invalid or expired shared monotonic deadline')
    @classmethod
    def now(cls):
        now=time.monotonic(); return cls({'monotonic_start':now,'monotonic_deadline':now+4200})
    def check(self,new_work=True):
        require(not (CANCELLED and new_work), 'cancel requested')
        require(self.clock()<self.end-(360 if new_work else 0), 'global deadline reserve reached')

class Supervisor:
    """Only spawned process groups are signalled; no name-based process kills."""
    def __init__(self, root, budget, sample=None, poll=1):
        self.root=root; self.budget=budget; self.poll=poll; self.launched=0
        self.sample=sample or self.resources; self.phase_deadline=None
        (root/'logs').mkdir(parents=True,exist_ok=True)
        (root/'receipts').mkdir(parents=True,exist_ok=True)
    def resources(self):
        started=time.monotonic(); size=0
        def walk_error(error): raise SafetyError('resource scan unknown') from error
        for directory, dirs, files in os.walk(self.root,followlinks=False,onerror=walk_error):
            for name in files:
                p=Path(directory)/name
                if not p.is_symlink(): size+=p.stat().st_size
                if time.monotonic()-started>2: raise SafetyError('resource measurement timed out')
        free=shutil.disk_usage(self.root).free
        start=self.root/'start.json'
        if start.exists():
            baseline=json.loads(start.read_text()).get('initial_free_bytes')
            require(type(baseline) is int and baseline>0,'job disk baseline unknown')
            # Dedicated hosted VM: count all growth conservatively, including
            # owned device data and Xcode files outside the explicit build root.
            size=max(size,baseline-free)
        return free,size
    def check(self,new_work=True, resource=True):
        self.budget.check(new_work)
        require(self.phase_deadline is None or time.monotonic()<self.phase_deadline,'aggregate stage deadline reached')
        if resource:
            try: free,size=self.sample()
            except Exception as e: raise SafetyError('resource sample unknown') from e
            with (self.root/'logs/resources.jsonl').open('a') as f:
                f.write(json.dumps({'monotonic':time.monotonic(),'free':free,'scratch':size})+'\n')
            require(free>3*GIB and size<4*GIB,'resource floor reached')
        self.budget.check(new_work)
        require(self.phase_deadline is None or time.monotonic()<self.phase_deadline,'stage expired during sample')
    @staticmethod
    def group_members(pgid):
        # ps is bounded, read-only, and never used to choose an unrelated group.
        listing=subprocess.run(['/bin/ps','-axo','pid=,pgid=,stat='],capture_output=True,text=True,timeout=1,check=True)
        return [int(parts[0]) for line in listing.stdout.splitlines()
                if len(parts:=line.split())==3 and int(parts[1])==pgid]
    @classmethod
    def stop(cls,p):
        # Once waitpid has reaped our leader, a same-numbered group is unknown.
        # Never signal it. While the original child is unreaped its PID cannot
        # be reused; keep it unreaped until all other group members have exited.
        if p.poll() is not None:
            require(not cls.group_members(p.pid),'reaped owner; remaining numeric group is unknown')
            return
        for sig,wait in ((signal.SIGINT,3),(signal.SIGTERM,2),(signal.SIGKILL,1)):
            require(p.returncode is None,'owner was unexpectedly reaped')
            try: os.killpg(p.pid,sig)
            except ProcessLookupError: pass
            until=time.monotonic()+wait
            while time.monotonic()<until:
                listing=subprocess.run(['/bin/ps','-axo','pid=,pgid=,stat='],capture_output=True,text=True,timeout=1,check=True)
                group={int(v[0]):v[2] for line in listing.stdout.splitlines()
                       if len(v:=line.split())==3 and int(v[1])==p.pid}
                if not group or (set(group)=={p.pid} and group[p.pid].startswith('Z')):
                    p.wait(timeout=1)
                    require(not cls.group_members(p.pid),'numeric group changed after reap')
                    return
                time.sleep(.03)
        p.wait(timeout=1)
        require(not cls.group_members(p.pid),'owned process group recovery incomplete')
    def run(self,argv,name,seconds,cwd=None,allow_failure=False,cleanup=False,capture=True):
        require(re.fullmatch(r'[a-zA-Z0-9_.-]+',name) is not None,'unsafe receipt name')
        self.check(new_work=not cleanup,resource=not cleanup)
        deadline=min(time.monotonic()+seconds,self.budget.end-(0 if cleanup else 360),self.phase_deadline or float('inf'))
        logfile=self.root/'logs'/f'{name}.log'
        receipt={'argv':[str(x) for x in argv],'started':False,'raw_exit':None,'reaped':False}
        # Construct the child environment rather than forwarding Actions/Secrets.
        env={key:os.environ[key] for key in ('PATH','HOME','TMPDIR','LANG','LC_ALL') if key in os.environ}
        env['DEVELOPER_DIR']=DEVELOPER
        problem=None; p=None
        try:
            with logfile.open('xb') as log:
                p=subprocess.Popen([str(x) for x in argv],cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
                self.launched+=1; receipt.update(started=True,pid=p.pid,pgid=p.pid,started_monotonic=time.monotonic())
                save(self.root/'receipts'/f'{name}-owner.json',receipt)
                while p.poll() is None:
                    self.check(new_work=not cleanup,resource=not cleanup)
                    require(time.monotonic()<deadline,'phase command deadline reached')
                    time.sleep(min(self.poll,max(.001,deadline-time.monotonic())))
        except BaseException as e:
            problem=e
        finally:
            if problem is None:
                try:
                    self.check(new_work=not cleanup,resource=not cleanup)
                    require(time.monotonic()<deadline,'command completed after local deadline')
                except BaseException as e: problem=e
            if p is not None:
                try:
                    self.stop(p); receipt['group_absent']=True
                except BaseException as e:
                    receipt['stop_error']=str(e); receipt['group_absent']=False; problem=e
                receipt.update(raw_exit=p.poll(),reaped=p.poll() is not None)
            receipt['finished_monotonic']=time.monotonic()
            if problem is not None: receipt['error']=str(problem)
            save(self.root/'receipts'/f'{name}-command.json',receipt)
        if problem: raise problem
        require(allow_failure or p.returncode==0,f'{name} failed with {p.returncode}')
        if capture:
            require(logfile.stat().st_size<=8*1024**2,'command capture exceeds bounded parser size')
        return p.returncode,logfile.read_text(errors='replace') if capture else ''


def dictionaries(value):
    if isinstance(value,dict):
        yield value
        for child in value.values(): yield from dictionaries(child)
    elif isinstance(value,list):
        for child in value: yield from dictionaries(child)

def check_xctestrun(path):
    data=plistlib.loads(path.read_bytes()); root=path.parent.resolve()
    targets=[v for v in dictionaries(data) if v.get('BlueprintName')=='LeafhourUITests' and 'TestBundlePath' in v]
    require(len(targets)==1,'expected exactly one UI target')
    t=targets[0]
    require(t.get('EnvironmentVariables',{}).get('LEAFHOUR_GET328_CURRENT_ACCEPTANCE')=='1','Runner env is not string 1')
    require(t.get('TestHostBundleIdentifier')==RUNNER_ID,'wrong test host identity')
    for v in dictionaries(data):
        for key,value in v.items():
            if 'repetit' in key.lower() or 'retry' in key.lower():
                require((type(value) is bool and value is False) or (type(value) is int and value==0) or (type(value) is str and value in ('none','None','disabled')),'unexpected test repetition')
    def resolve(value,host=None):
        require(isinstance(value,str),'missing product path')
        p=Path(value.replace('__TESTROOT__',str(root)).replace('__TESTHOST__',str(host or ''))).resolve()
        require(p.is_relative_to(root) and p.exists(),'escaped or missing xctestrun product')
        return p
    host=resolve(t.get('TestHostPath'))
    app=resolve(t.get('UITargetAppPath')); bundle=resolve(t.get('TestBundlePath'),host)
    return {'path':str(path),'sha256':sha(path),'test_host':str(host),'app':str(app),'test_bundle':str(bundle),'runner_env':'1'}

def test_outcome(data,identifier,exit_code):
    nodes=[v for v in dictionaries(data.get('testNodes',[])) if v.get('nodeType')=='Test Case']
    require(len(nodes)==1 and nodes[0].get('nodeIdentifier') in (identifier,identifier.removesuffix('()')),'missing, extra or wrong XCTest case')
    status=nodes[0].get('result')
    require(status in ('Passed','Failed'),'test did not establish a started result')
    if status=='Passed': return 'passed' if exit_code==0 else 'infrastructure-failed'
    return 'unclassified-test-failure' if exit_code==65 else 'infrastructure-failed'

def runtime_architecture(runtime_root):
    for name in ('dyld_shared_cache_x86_64','dyld_shared_cache_x86_64h'):
        p=runtime_root/'System/Library/dyld'/name
        if p.is_file():
            with p.open('rb') as f: header=f.read(4096)
            if header[:16].rstrip(b'\0 ').startswith(b'dyld_v1') and b'x86_64' in header[:16]:
                return {'architecture':'x86_64','path':str(p),'header_hex':header[:16].hex(),'prefix4096_sha256':hashlib.sha256(header).hexdigest()}
    raise SafetyError('installed runtime Intel architecture unproved')

def verify_products(root,deadline=None):
    manifest=json.loads((root/'receipts/products.json').read_text())
    actual=set()
    for p in (root/'products').rglob('*'):
        require(deadline is None or time.monotonic()<deadline,'Products verification deadline exceeded')
        if p.is_file() and not p.is_symlink(): actual.add(str(p.relative_to(root/'products')))
    require(actual=={f['path'] for f in manifest['files']},'Products file set changed')
    links={str(p.relative_to(root/'products')):os.readlink(p) for p in (root/'products').rglob('*') if p.is_symlink()}
    require(links=={v['path']:v['target'] for v in manifest.get('links',[])},'Products links changed')
    for name,target in links.items():
        require(not Path(target).is_absolute() and (root/'products'/name).resolve(strict=True).is_relative_to((root/'products').resolve()),'Products link escaped')
    for entry in manifest['files']:
        p=root/'products'/entry['path']
        require(p.resolve().is_relative_to((root/'products').resolve()) and not p.is_symlink(),'Products escaped')
        require(p.stat().st_size==entry['bytes'] and sha(p,deadline)==entry['sha256'],'Products bytes changed')

def owned_directory(root,path):
    current=root
    for part in path.relative_to(root).parts:
        current=current/part
        try: info=current.lstat()
        except FileNotFoundError: return False
        require(stat.S_ISDIR(info.st_mode),'foreign or symlinked recovery component')
    return True

def move_owned_directory(root,source,dest):
    flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
    handles=[]
    def parent(path,create):
        fd=os.open(root,flags); handles.append(fd)
        parts=path.relative_to(root).parts
        for part in parts[:-1]:
            if create:
                try: os.mkdir(part,dir_fd=fd)
                except FileExistsError: pass
            fd=os.open(part,flags,dir_fd=fd); handles.append(fd)
        return fd,parts[-1]
    try:
        source_fd,source_name=parent(source,False); dest_fd,dest_name=parent(dest,True)
        require(stat.S_ISDIR(os.stat(source_name,dir_fd=source_fd,follow_symlinks=False).st_mode),'recovery leaf is not real directory')
        try: os.stat(dest_name,dir_fd=dest_fd,follow_symlinks=False)
        except FileNotFoundError: pass
        else: raise SafetyError('recovery destination already exists')
        os.rename(source_name,dest_name,src_dir_fd=source_fd,dst_dir_fd=dest_fd)
        require(stat.S_ISDIR(os.stat(dest_name,dir_fd=dest_fd,follow_symlinks=False).st_mode),'recovery directory changed during move')
    except OSError as e: raise SafetyError('recovery path ownership unproved') from e
    finally:
        for fd in reversed(handles): os.close(fd)

def prepare_evidence_view(root):
    root=root.resolve()
    require(set(p.name for p in root.iterdir())<={'start.json','scratch','logs','results','products','receipts','fixture'},'unexpected job-root contents')
    require((root/'start.json').is_file() and not (root/'start.json').is_symlink(),'missing original start')
    require(not (root/'scratch').is_symlink(),'foreign scratch')
    # A first failed/terminated build may never reach build()'s successful move.
    # Salvage actual partial Products and activity logs before excluding caches.
    recovered=[]
    for source,dest in ((root/'scratch/DerivedData/Build/Products',root/'products'),
                        (root/'scratch/DerivedData/Logs',root/'logs/deriveddata')):
        if owned_directory(root,source):
            move_owned_directory(root,source,dest); recovered.append({'from':str(source),'to':str(dest)})
    receipts=root/'receipts'; receipts.mkdir(exist_ok=True)
    save(receipts/'recovered-build-outputs.json',{'recovered':recovered,'known_outputs_remaining_in_scratch':False})
    with (receipts/'start.json').open('xb') as f: f.write((root/'start.json').read_bytes())
    save(receipts/'packaging-source.json',{'original_root':str(root),'start_sha256':sha(root/'start.json'),'excluded':[{'path':'scratch','reason':'Rebuildable DerivedData caches/intermediates only; actual Products moved to products, build/case xcresults in results, DerivedData Logs moved to logs/deriveddata; original scratch is not deleted.'}]})
    view=root.parent/'get328-hosted-evidence-view'; view.mkdir(mode=0o700)
    for name in ('logs','results','products','receipts','fixture'):
        if (root/name).exists(): (root/name).rename(view/name)
    return view

class Controller:
    def __init__(self,source,root):
        require_host(os.environ)
        self.root=root.resolve(); self.source=source.resolve()
        expected=Path(os.environ['RUNNER_TEMP']).resolve()/'get328-hosted'
        require(self.root==expected and not root.is_symlink(),'wrong owned job root')
        self.start=json.loads((root/'start.json').read_text()); self.budget=Budget(self.start)
        require(type(self.start.get('initial_free_bytes')) is int and self.start['initial_free_bytes']>0,'job disk baseline is required')
        require(str(self.start['run_id'])==os.environ['GITHUB_RUN_ID'] and self.start['controller_sha']==os.environ['GITHUB_SHA'],'start binding mismatch')
        self.s=Supervisor(root,self.budget)
        self.admission=json.loads((root/'receipts/admission.json').read_text())
        require(self.admission.get('allowed') is True and self.admission.get('controller_sha')==os.environ['GITHUB_SHA'],'not admitted')
        require(str(self.admission.get('run_id'))==os.environ['GITHUB_RUN_ID'],'admission run mismatch')
        self.state=json.loads((root/'receipts/prepared.json').read_text()) if (root/'receipts/prepared.json').exists() else None
    def cmd(self,argv,name,seconds=30,**kwargs): return self.s.run(argv,name,seconds,**kwargs)[1].strip()
    def sim(self,args,name,seconds=30,**kwargs): return self.cmd(['xcrun','simctl',*args],name,seconds,**kwargs)
    def identities(self,stage):
        for directory,expected,tag in ((self.source,SOURCE_SHA,'source'),(Path(__file__).resolve().parents[2],os.environ['GITHUB_SHA'],'controller')):
            require(self.cmd(['git','rev-parse','HEAD'],stage+'-'+tag+'-head',cwd=directory)==expected,'checkout head changed')
            require(not self.cmd(['git','status','--porcelain'],stage+'-'+tag+'-clean',cwd=directory),'checkout dirty')
        require(self.cmd(['git','rev-parse','HEAD^{tree}'],stage+'-source-tree',cwd=self.source)==SOURCE_TREE,'source tree changed')
    def prepare(self):
        # Stay inside the 6-minute Actions step, reserving30s for owned-command stop.
        self.s.phase_deadline=min(self.budget.start+600,time.monotonic()+330,self.budget.end-360)
        self.identities('prepare')
        from hosted_get328_admission import fetch_json, API_ROOT
        jobs,raw,link=fetch_json(API_ROOT+'/actions/runs/'+os.environ['GITHUB_RUN_ID']+'/jobs?per_page=100')
        require(not link and jobs.get('total_count')==1 and len(jobs.get('jobs',[]))==1,'allocated job identity unknown')
        job=jobs['jobs'][0]
        require(job.get('labels')==['macos-26-intel'] and job.get('status')=='in_progress' and job.get('runner_name'),'runner is not allocated standard Intel')
        save(self.root/'receipts/allocated-job.json',jobs)
        require(os.environ.get('ImageOS')=='macos26' and bool(os.environ.get('ImageVersion')),'actual image identity unproved')
        save(self.root/'receipts/host-image.json',{'ImageOS':os.environ['ImageOS'],'ImageVersion':os.environ['ImageVersion'],'RUNNER_ARCH':os.environ['RUNNER_ARCH'],'machine':platform.machine(),'cpu_count':os.cpu_count(),'DEVELOPER_DIR':DEVELOPER})
        require(time.monotonic()<self.budget.start+600,'bootstrap expired')
        require(shutil.disk_usage(self.root).free>=8*GIB,'start free space below 8GiB')
        version=self.cmd(['xcodebuild','-version'],'xcode-version')
        require(version=='Xcode 26.6\nBuild version 17F113','Xcode mismatch')
        require(self.cmd(['xcrun','--sdk','iphonesimulator','--show-sdk-version'],'sdk-version')=='26.5','SDK mismatch')
        sdk=Path(self.cmd(['xcrun','--sdk','iphonesimulator','--show-sdk-path'],'sdk-path'))
        require('x86_64-ios-simulator' in (sdk/'usr/lib/libSystem.tbd').read_text(),'SDK lacks Intel support')
        runtimes=json.loads(self.sim(['list','runtimes','--json'],'runtimes',180))
        candidates=[r for r in runtimes['runtimes'] if r.get('version')=='26.5' and r.get('isAvailable') is True and r.get('identifier','').startswith('com.apple.CoreSimulator.SimRuntime.iOS-')]
        require(len(candidates)==1,'installed iOS26.5 unavailable/ambiguous')
        rt=candidates[0]; rtroot=Path(rt['bundlePath'])/'Contents/Resources/RuntimeRoot'
        arch=runtime_architecture(rtroot.resolve())
        devices=json.loads(self.sim(['list','devices','--json'],'initial-devices',180))
        require(not any(d.get('state')=='Booted' for ds in devices['devices'].values() for d in ds),'preexisting booted device')
        fixture=Path(__file__).resolve().parents[2]/'ci/fixtures/get328/Alice-complete-GET328-20261107.pdf'
        require(fixture.stat().st_size==243472 and sha(fixture)==PDF_SHA,'canonical Alice73 differs')
        manifest=fixture.parent/'manifest.json'
        require(sha(manifest)==FIXTURE_MANIFEST_SHA,'canonical PDF coverage manifest differs')
        (self.root/'fixture').mkdir(); shutil.copy2(fixture,self.root/'fixture'/fixture.name)
        shutil.copy2(manifest,self.root/'fixture/manifest.json')
        save(self.root/'receipts/create-intent.json',{'name':'GET328-'+os.environ['GITHUB_RUN_ID'],'runtime':rt['identifier'],'outcome':'not yet known'})
        udid=self.sim(['create','GET328-'+os.environ['GITHUB_RUN_ID'],'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',rt['identifier']],'create-device')
        require(re.fullmatch(r'[A-Fa-f0-9-]{36}',udid) is not None,'device UUID unproved')
        # Write ownership before any boot. Only this UUID can ever be deleted.
        state={'udid':udid,'runtime':rt,'architecture':arch,'app_category_direct_readback':'unproved','initial_orientation':'new-disposable-device; no shared orientation claim'}
        save(self.root/'receipts/device-owner.json',state)
        self.sim(['boot',udid],'boot-device')
        self.sim(['bootstatus',udid,'-b'],'boot-ready',120)
        require(time.monotonic()<self.budget.start+600,'bootstrap exceeded before native build')
        save(self.root/'receipts/prepared.json',state)
    def build(self):
        require(self.state is not None,'prepare not complete')
        self.s.phase_deadline=min(time.monotonic()+1200,self.budget.end-360)
        self.identities('build')
        dd=self.root/'scratch/DerivedData'; (self.root/'results').mkdir(exist_ok=True)
        self.cmd(['xcodebuild','-project',self.source/'apps/ios/Leafhour.xcodeproj','-scheme','LeafhourGET328CurrentAcceptance','-configuration','GET328Acceptance','-sdk','iphonesimulator','-destination','platform=iOS Simulator,id='+self.state['udid'],'-derivedDataPath',dd,'-resultBundlePath',self.root/'results/build.xcresult','-jobs','2','-parallel-testing-enabled','NO','ARCHS=x86_64','ONLY_ACTIVE_ARCH=NO','CODE_SIGNING_ALLOWED=NO','LEAFHOUR_BUNDLE_ID='+APP_ID,'ENABLE_PREVIEWS=NO','build-for-testing'],'build',1200,cwd=self.source,capture=False)
        products=self.root/'products'; (dd/'Build/Products').rename(products)
        files=[]; executables=[]; links=[]
        if (dd/'Logs').exists(): (dd/'Logs').rename(self.root/'logs/deriveddata')
        for p in sorted(products.rglob('*')):
            self.s.check()
            if p.is_symlink():
                target=os.readlink(p)
                require(not Path(target).is_absolute() and p.resolve(strict=True).is_relative_to(products),'Products link escaped')
                links.append({'path':str(p.relative_to(products)),'target':target}); continue
            if not p.is_file(): continue
            with p.open('rb') as f: header=f.read(16)
            macho=header[:4] in (b'\xcf\xfa\xed\xfe',b'\xfe\xed\xfa\xcf',b'\xca\xfe\xba\xbe',b'\xbe\xba\xfe\xca')
            filetype=struct.unpack('<I',header[12:16])[0] if header[:4]==b'\xcf\xfa\xed\xfe' else None
            if macho and (filetype in (2,6,8) or filetype is None):
                tag='macho-'+str(len(executables))
                archs=self.cmd(['xcrun','lipo','-archs',p],tag+'-arch')
                build=self.cmd(['xcrun','vtool','-show-build',p],tag+'-platform')
                require('x86_64' in archs.split() and re.search(r'platform\s+(?:IOSSIMULATOR|7)\b',build),'non-Intel/Simulator executable')
                executables.append(str(p.relative_to(products)))
            files.append({'path':str(p.relative_to(products)),'sha256':sha(p),'bytes':p.stat().st_size})
        require(len(executables)>=4,'missing QA executable products')
        for identifier in (APP_ID,APP_ID+'.listening',APP_ID+'.uitests',RUNNER_ID):
            matches=[p for p in products.rglob('Info.plist') if plistlib.loads(p.read_bytes()).get('CFBundleIdentifier')==identifier]
            require(len(matches)==1,'missing/duplicate QA bundle '+identifier)
            info=plistlib.loads(matches[0].read_bytes())
            exe=(matches[0].parent/info['CFBundleExecutable']).resolve()
            require(exe.is_file() and exe.is_relative_to(products) and str(exe.relative_to(products)) in executables,'bundle executable not verified Intel Simulator Mach-O')
        xr=list(products.glob('*.xctestrun')); require(len(xr)==1,'ambiguous xctestrun')
        config=check_xctestrun(xr[0]); save(self.root/'receipts/products.json',{'files':files,'links':links,'executables':executables,'xctestrun':config,'new_x86_64_domain':True,'old99_replay':False})
        self.sim(['install',self.state['udid'],config['app']],'install-qa',90)
        save(self.root/'receipts/built.json',config)
    def seven(self):
        self.identities('seven'); verify_products(self.root)
        config=json.loads((self.root/'receipts/built.json').read_text())
        require(check_xctestrun(Path(config['path']))==config,'xctestrun changed')
        deadline=min(time.monotonic()+1800,self.budget.end-360); self.s.phase_deadline=deadline; results=[]
        try:
            for cid,category,identifier in CASES:
                require(time.monotonic()<deadline,'whole seven UI budget expired')
                record={'id':cid,'selector':'LeafhourUITests/'+identifier,'os_category':None,'app_category_direct_readback':'unproved','outcome':'blocked','raw_exit':None,'actual_started':False,'launcher_started':False,'xctestrun_sha256':config['sha256']}
                results.append(record)
                for bundle,label in ((APP_ID,'app'),(RUNNER_ID,'runner')):
                    _,raw=self.s.run(['xcrun','simctl','terminate',self.state['udid'],bundle],cid+'-cold-'+label,15,allow_failure=True)
                    receipt=json.loads((self.root/f'receipts/{cid}-cold-{label}-command.json').read_text())
                    require(receipt['raw_exit']==0 or re.search(r'(not running|found nothing to terminate)',raw,re.I),'cold-stop outcome unknown')
                self.sim(['ui',self.state['udid'],'content_size',category],cid+'-set-type')
                actual=self.sim(['ui',self.state['udid'],'content_size'],cid+'-get-type')
                require(actual==category,'actual OS category differs'); record['os_category']=actual
                if cid=='pdf73':
                    container=Path(self.sim(['get_app_container',self.state['udid'],APP_ID,'data'],'pdf-container'))
                    require(container.is_absolute() and self.state['udid'].lower() in str(container).lower(),'foreign app container')
                    dest=container/'Documents/GET328AcceptanceSources/Alice-complete-GET328-20261107.pdf'
                    dest.parent.mkdir(parents=True,exist_ok=True)
                    require(not dest.exists() or sha(dest)==PDF_SHA,'PDF stage would overwrite different bytes')
                    shutil.copy2(self.root/'fixture'/dest.name,dest); require(sha(dest)==PDF_SHA,'PDF stage hash differs')
                result=self.root/'results'/f'{cid}.xcresult'
                code,raw=self.s.run(['xcodebuild','-xctestrun',config['path'],'-destination','platform=iOS Simulator,id='+self.state['udid'],'-resultBundlePath',result,'-parallel-testing-enabled','NO','-test-iterations','1','-only-testing:LeafhourUITests/'+identifier.removesuffix('()'),'test-without-building'],cid+'-test',max(.01,deadline-time.monotonic()),cwd=self.source,allow_failure=True,capture=False)
                data=json.loads(self.cmd(['xcrun','xcresulttool','get','test-results','tests','--path',result,'--compact'],cid+'-test-tree'))
                outcome=test_outcome(data,identifier,code)
                with (self.root/'logs'/f'{cid}-test.log').open(errors='replace') as log:
                    started=any(re.search(r"Test Case .*"+re.escape(identifier.split('/')[1].removesuffix('()'))+r".* started\.",line) for line in log)
                require(started,'exact test start marker unproved')
                record.update(outcome=outcome,raw_exit=code,actual_started=True,launcher_started=True)
                self.sim(['io',self.state['udid'],'screenshot',self.root/'results'/f'{cid}-after.png'],cid+'-screenshot')
                if outcome!='passed': raise SafetyError('failed or unclassified test; stop remaining cases without retry')
        finally:
            for record in results:
                cid=record['id']; command=self.root/'receipts'/f'{cid}-test-command.json'
                if command.exists():
                    raw_command=json.loads(command.read_text()); record['launcher_started']=raw_command['started']; record['raw_exit']=raw_command['raw_exit']
                    if record['actual_started'] is not True and raw_command['started']: record['actual_started']=None
                save(self.root/'receipts'/f'{cid}-result.json',record)
            save(self.root/'receipts/seven.json',{'cases':results,'not_run':[c[0] for c in CASES[len(results):]],'all_passed':len(results)==7 and all(r['outcome']=='passed' for r in results)})
    def cleanup(self):
        self.s.phase_deadline=min(time.monotonic()+120,self.budget.end)
        owner=self.root/'receipts/device-owner.json'
        if owner.exists():
            udid=json.loads(owner.read_text())['udid']
            require(re.fullmatch(r'[A-Fa-f0-9-]{36}',udid) is not None,'bad owned UUID')
            self.sim(['shutdown',udid],'cleanup-shutdown',30,allow_failure=True,cleanup=True)
            self.sim(['delete',udid],'cleanup-delete',30,cleanup=True)
            devices=json.loads(self.sim(['list','devices','--json'],'cleanup-device-readback',30,cleanup=True))
            require(not any(d.get('udid')==udid for ds in devices['devices'].values() for d in ds),'owned device still present')
        if not owner.exists() and (self.root/'receipts/create-intent.json').exists():
            save(self.root/'receipts/cleanup.json',{'owned_device_absent':False,'creation_outcome':'unknown; do not infer UUID or delete other devices'})
            raise SafetyError('device creation outcome unknown')
        save(self.root/'receipts/cleanup.json',{'owned_device_absent':True,'shared_device_touched':False,'orientation_restored_claim':False})

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage',choices=['prepare','build','seven','cleanup','package','verify-download'])
    parser.add_argument('--source',type=Path); parser.add_argument('--root',type=Path,required=True)
    parser.add_argument('--archive',type=Path); parser.add_argument('--manifest',type=Path)
    parser.add_argument('--expected-manifest-sha256')
    args=parser.parse_args()
    if args.stage=='verify-download':
        from hosted_get328_evidence import verify_download
        require(args.expected_manifest_sha256 is not None and re.fullmatch('[a-f0-9]{64}',args.expected_manifest_sha256) and sha(args.manifest)==args.expected_manifest_sha256,'trusted run manifest hash is required and must match')
        print(json.dumps(verify_download(args.archive,args.manifest,args.root))); return
    if args.stage=='package':
        from hosted_get328_evidence import package_evidence
        # Packaging is non-native and can preserve an unadmitted partial run.
        start=json.loads((args.root/'start.json').read_text()); budget=Budget(start); budget.check(False)
        package_deadline=min(time.monotonic()+60,budget.end)
        seven_path=args.root/'receipts/seven.json'
        seven=json.loads(seven_path.read_text()) if seven_path.exists() else {}
        cleanup_path=args.root/'receipts/cleanup.json'
        identity_ok=False
        if (args.root/'receipts/products.json').exists():
            try: verify_products(args.root,deadline=package_deadline); identity_ok=True
            except (SafetyError,OSError) as e: save(args.root/'receipts/products-identity-failure.json',{'error':str(e),'preserve_actual_bytes_as_partial':True})
        cleanup=json.loads(cleanup_path.read_text()) if cleanup_path.exists() else {}
        complete=identity_ok and seven.get('all_passed') is True and cleanup.get('owned_device_absent') is True and not list((args.root/'receipts').glob('*-failure.json'))
        save(args.root/'receipts/report.json',{'status':'complete' if complete else 'partial','partial_reason':None if complete else 'seven/build/admission/recovery incomplete; inspect immutable receipts','source_sha':SOURCE_SHA,'app_category_direct_readback':'unproved','start':start})
        view=prepare_evidence_view(args.root)
        require(time.monotonic()<package_deadline,'package deadline elapsed before tar')
        outcome=package_evidence(view,args.root.parent/'get328-hosted-upload',deadline=package_deadline)
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'],'a') as f: f.write('bounded=true\ndir='+str(args.root.parent/'get328-hosted-upload')+'\n')
        print(json.dumps(outcome)); return
    require(args.source is not None,'source is required')
    controller=Controller(args.source,args.root)
    try:
        getattr(controller,args.stage)()
    except BaseException as e:
        save(args.root/'receipts'/f'{args.stage}-failure.json',{'stage':args.stage,'error':str(e),'native_success_claim':False})
        raise

def cancel(signum,frame):
    global CANCELLED
    CANCELLED=True

if __name__=='__main__':
    signal.signal(signal.SIGINT,cancel); signal.signal(signal.SIGTERM,cancel)
    try: main()
    except (SafetyError,ValueError,OSError,KeyError) as e:
        print('BLOCKED: '+str(e),file=sys.stderr); sys.exit(78)
