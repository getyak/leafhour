import test from 'node:test';
import assert from 'node:assert/strict';
const module=()=>import('../app/library-arrival-state.mjs');
const tick=()=>new Promise(setImmediate);
const data={date:'2026-10-15',timeZone:'UTC',yesterday:{date:'2026-10-14',durationSeconds:0,books:[]},lastRead:null};
async function fixture(){const {createLibraryArrivalState}=await module();let owner='a:1',date=data.date,visible=true;const values=new Map(),pending=[],shown=[],storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},state=createLibraryArrivalState({getOwner:()=>owner,getAccount:()=>owner?.split(':')[0],dateKey:()=>date,timeZone:'UTC',storage,load:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),canShow:()=>visible,onShow:value=>shown.push(value),onHide(){}});return {state,pending,shown,storage,setOwner:v=>owner=v,setDate:v=>date=v,setVisible:v=>visible=v};}
test('one successful visible greeting per account/day; dismissal and reload do not repeat it',async()=>{
 const f=await fixture();f.state.update();f.state.update();assert.equal(f.pending.length,1);f.pending[0].resolve(data);await tick();assert.equal(f.shown.length,1);f.state.dismiss();f.state.update();await tick();assert.equal(f.pending.length,1);assert.equal(f.shown.length,1);
});
test('hidden, editing and open-dialog arrivals wait without consuming the daily greeting',async()=>{
 const f=await fixture();f.setVisible(false);f.state.update();f.pending[0].resolve(data);await tick();assert.equal(f.shown.length,0);f.setVisible(true);f.state.update();await tick();assert.equal(f.shown.length,1);
});
test('owner revision change and sign-out fence late data; failed loads can retry',async()=>{
 const f=await fixture();f.state.update();f.setOwner('b:2');f.state.update();f.pending[0].resolve(data);await tick();assert.equal(f.shown.length,0);f.pending[1].reject(Error('offline'));await tick();f.state.update();assert.equal(f.pending.length,3);f.setOwner(null);f.state.update();f.pending[2].resolve(data);await tick();assert.equal(f.shown.length,0);
});
test('disable persists by account and midnight requests cannot show yesterday\'s greeting',async()=>{
 const f=await fixture();f.state.update();f.setDate('2026-10-16');f.pending[0].resolve(data);await tick();assert.equal(f.shown.length,0);f.state.setEnabled(false);f.state.update();assert.equal(f.pending.length,1);f.state.setEnabled(true);assert.equal(f.pending.length,2);f.pending[1].resolve({...data,date:'2026-10-16'});await tick();assert.equal(f.shown.length,1);
});
test('readable but full browser storage still remembers dismissal and a disabled preference',async()=>{
 const {createLibraryArrivalState}=await module();let loads=0,shows=0;const state=createLibraryArrivalState({getOwner:()=> 'a:1',getAccount:()=> 'a',dateKey:()=>data.date,timeZone:'UTC',storage:{getItem:()=>null,setItem(){throw Error('quota');}},load:async()=>{loads++;return data;},canShow:()=>true,onShow(){shows++;},onHide(){}});
 state.update();await tick();state.dismiss();state.update();await tick();assert.equal(loads,1);assert.equal(shows,1);state.setEnabled(false);assert.equal(state.enabled(),false);
});
