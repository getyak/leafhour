import test from 'node:test';
import assert from 'node:assert/strict';
import {upsertObservabilityDashboards,observabilityDashboards} from '../tools/configure-observability.mjs';

test('existing named dashboards are updated without adding duplicates; missing dashboards get real insights',async()=>{
 const dashboards=[{id:9,name:'Leafhour · 故障'}],insights=[],calls=[];
 async function request(route,{method='GET',body}={}){
  calls.push({route,method,body});
  if(route==='/dashboards/'&&method==='GET')return {results:dashboards,next:null};
  if(route==='/dashboards/'&&method==='POST'){const d={id:10+dashboards.length,...body};dashboards.push(d);return d;}
  if(route.split('?')[0]==='/insights/'&&method==='GET')return {results:insights,next:null};
  if(route==='/insights/'&&method==='POST'){const i={id:20+insights.length,...body};insights.push(i);return i;}
  if(method==='PATCH')return {id:Number(route.match(/\d+/)[0]),...body};
  throw Error('Unexpected route');
 }
 const first=await upsertObservabilityDashboards(request);
 assert.equal(first.length,3);assert.equal(dashboards.length,3);assert.ok(insights.length>=5);
 await upsertObservabilityDashboards(request);
 assert.equal(dashboards.length,3);assert.equal(insights.length,first.reduce((n,d)=>n+d.insights.length,0));
 assert.ok(calls.filter(c=>c.method==='PATCH').some(c=>c.route==='/dashboards/9/'));
 assert.ok(insights.every(i=>i.query.source.properties.some(p=>p.key==='synthetic'&&p.value===true&&p.operator==='is_not')));
});

test('retention starts from actual reading and first-reading funnel does not require upload',()=>{
 const definitions=observabilityDashboards();
 const funnels=definitions.flatMap(d=>d.insights).filter(i=>i.query.source.kind==='FunnelsQuery');
 assert.deepEqual(funnels[0].query.source.series.map(e=>e.event),['library_opened','reader_open_requested','reader_content_visible']);
 const retention=definitions.flatMap(d=>d.insights).find(i=>i.query.source.kind==='RetentionQuery');
 assert.equal(retention.query.source.retentionFilter.targetEntity.id,'reader_active');assert.equal(retention.query.source.retentionFilter.returningEntity.id,'reader_active');
 assert.equal(retention.query.source.retentionFilter.totalIntervals,8);
});

test('vendor management errors fail visibly rather than reporting configured dashboards',async()=>{
 await assert.rejects(upsertObservabilityDashboards(async()=>{throw Error('management access unavailable');}),/management access unavailable/);
});
