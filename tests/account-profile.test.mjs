import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {digest} from '../server/document-import.mjs';
import {createHostedAuth} from '../deploy/hosted-auth.mjs';
import {authFixture} from './auth-fixture.mjs';

const profileModule=await import('../server/account-profile.mjs').catch(()=>({}));
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jnhkAAAAASUVORK5CYII=';
const user={id:'account-a',email:'reader@example.com',kind:'google',displayName:'Provider Name',avatarUrl:'https://images.example.com/avatar.png'};
const make=options=>{assert.equal(typeof profileModule.createAccountProfile,'function','account profiles must have an owned persistence service');return profileModule.createAccountProfile(options);};
async function local(t){const dataDir=await mkdtemp(path.join(os.tmpdir(),'account-profile-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));return {dataDir,profile:make({dataDir})};}

test('hosted identity exposes sanitized provider name and avatar without provider secrets',async()=>{
  const f=authFixture();Object.assign(f.user.user_metadata,{full_name:'  Lin Reader  ',name:'Other',avatar_url:'https://images.example.com/me.png',provider_token:'private-provider-token'});
  f.user.app_metadata.provider='google';f.user.provider_token='never-public';
  const auth=createHostedAuth({...f,store:f.store()}),session=await auth.signInPassword('reader@example.com','fixture-password');
  assert.deepEqual(session.user,{id:'user-a',email:'reader@example.com',kind:'google',displayName:'Lin Reader',avatarUrl:'https://images.example.com/me.png'});
  assert.deepEqual(await auth.userFor(session.token),session.user);
  assert.doesNotMatch(JSON.stringify(session.user),/access|refresh|token|private|app_metadata|user_metadata/);
});
test('provider identity accepts alternate metadata and rejects unsafe avatar URLs',async()=>{
  for(const url of ['javascript:alert(1)','data:image/svg+xml,<svg/>','http://example.com/a.png','https://secret@example.com/a.png','https://example.com/'+('a'.repeat(2100))]){
    const f=authFixture();f.user.user_metadata={name:' Lin ',picture:url};
    const auth=createHostedAuth({...f,store:f.store()}),session=await auth.signInPassword('reader@example.com','fixture-password');
    assert.equal(session.user.displayName,'Lin');assert.equal(session.user.avatarUrl,null);
  }
  const f=authFixture();f.user.user_metadata={full_name:{bad:true},name:' N '.repeat(100),picture:'https://example.com/avatar.webp'};
  const session=await createHostedAuth({...f,store:f.store()}).signInPassword('reader@example.com','fixture-password');
  assert.ok([...session.user.displayName].length<=80);assert.equal(session.user.avatarUrl,'https://example.com/avatar.webp');
});
test('an untouched account keeps provider identity and saves owned overrides durably',async(t)=>{
  const {dataDir,profile}=await local(t);assert.deepEqual(await profile.get(user),{displayName:'Provider Name',avatarUrl:user.avatarUrl});
  assert.deepEqual(await profile.save(user,{displayName:'  书房主人  ',avatarData:png}),{displayName:'书房主人',avatarUrl:png});
  assert.deepEqual(await make({dataDir}).get(user),{displayName:'书房主人',avatarUrl:png});
  const record=JSON.parse(await readFile(path.join(dataDir,'users',digest(user.id),'profile.json'),'utf8'));
  assert.equal(record.displayName,'书房主人');assert.equal(record.avatarData,png);assert.equal(record.email,undefined);assert.equal(record.user,undefined);
  assert.deepEqual(await readdir(path.join(dataDir,'users',digest(user.id))),['profile.json']);
});
test('profiles require authenticated ownership and cannot be reassigned through submitted fields',async(t)=>{
  const {profile}=await local(t);await assert.rejects(profile.get(null),e=>e.status===401);await assert.rejects(profile.save(null,{displayName:'Me'}),e=>e.status===401);
  await profile.save(user,{displayName:'Private Name',avatarData:png});
  assert.deepEqual(await profile.get({...user,id:'account-b',displayName:'Other',avatarUrl:null}),{displayName:'Other',avatarUrl:null});
  await assert.rejects(profile.save(user,{id:'account-b',displayName:'Changed'}),e=>e.status===400);
});
test('invalid names or image payloads leave the saved profile intact',async(t)=>{
  const {profile}=await local(t);await profile.save(user,{displayName:'Saved'});
  for(const displayName of [null,42,{},'a'.repeat(81),'line\nbreak','invisible\u0000'])await assert.rejects(profile.save(user,{displayName}),e=>e.status===400);
  for(const avatarData of ['https://example.com/me.png','data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,bm90YW5pbWFnZQ==',png.replace('image/png','image/jpeg'),png+'!', 'data:image/png;base64,'+Buffer.alloc(102401).toString('base64'),{}])await assert.rejects(profile.save(user,{avatarData}),e=>[400,413].includes(e.status));
  assert.deepEqual(await profile.get(user),{displayName:'Saved',avatarUrl:user.avatarUrl});
});
test('clearing overrides restores provider defaults while name-only updates preserve the avatar',async(t)=>{
  const {profile}=await local(t);await profile.save(user,{displayName:'Saved',avatarData:png});
  assert.equal((await profile.save(user,{displayName:'New'})).avatarUrl,png);
  assert.deepEqual(await profile.save(user,{displayName:'',avatarData:null}),{displayName:'Provider Name',avatarUrl:user.avatarUrl});
});
test('hosted profile instances share isolated durable records through the supplied compare-and-swap store',async()=>{
  const f=authFixture(),a=make({dataDir:'profile-fixture',dataStore:f.store()}),b=make({dataDir:'profile-fixture',dataStore:f.store()});
  await a.save(user,{displayName:'Shared',avatarData:png});
  assert.deepEqual(await b.get(user),{displayName:'Shared',avatarUrl:png});
  await Promise.all([a.save(user,{displayName:'Concurrent'}),b.save(user,{avatarData:null})]);
  assert.deepEqual(await a.get(user),{displayName:'Concurrent',avatarUrl:user.avatarUrl});
  assert.deepEqual([...f.rows.keys()],[path.join('profile-fixture','users',digest(user.id),'profile.json')]);
  assert.doesNotMatch(JSON.stringify([...f.rows]),/reader@example|access-fixture|refresh-fixture|server-fixture/);
});

test('image headers without a raster payload cannot be saved as avatars',async(t)=>{
  const {profile}=await local(t),webp=Buffer.alloc(20);webp.write('RIFF');webp.writeUInt32LE(12,4);webp.write('WEBPVP8 ',8);
  const hollowPng=Buffer.from(png.split(',')[1],'base64');hollowPng.write('VOID',hollowPng.indexOf('IDAT'));
  for(const [type,bytes]of [['jpeg',Buffer.from([255,216,255,217])],['webp',webp],['png',hollowPng]])await assert.rejects(profile.save(user,{avatarData:'data:image/'+type+';base64,'+bytes.toString('base64')}),e=>e.status===400);
});

test('supported JPEG and WebP raster payloads remain available after saving',async(t)=>{
  const {profile}=await local(t),rasters={
    jpeg:'/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDeoooqDhP/2Q==',
    webp:'UklGRiwAAABXRUJQVlA4ICAAAABQAQCdASoBAAEAAUAmJQBOgCgAAP7tKhCH195Q7EmAAA=='
  };
  for(const [type,bytes]of Object.entries(rasters)){const avatarData='data:image/'+type+';base64,'+bytes;assert.equal((await profile.save(user,{avatarData})).avatarUrl,avatarData);}
});
test('local saves from separate profile instances preserve concurrent changes',async(t)=>{
  const {profile,dataDir}=await local(t),other=make({dataDir});
  await Promise.all([profile.save(user,{displayName:'Concurrent'}),other.save(user,{avatarData:png})]);
  assert.deepEqual(await profile.get(user),{displayName:'Concurrent',avatarUrl:png});
});
