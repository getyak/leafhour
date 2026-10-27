import {pathToFileURL} from 'node:url';

const properties=()=>[
 {key:'environment',type:'event',value:'production',operator:'exact'},
 {key:'synthetic',type:'event',value:true,operator:'is_not'},
];
const events=names=>names.map((id,order)=>({id,name:id,type:'events',order}));
const trend=(name,names,extra={})=>({name,filters:{insight:'TRENDS',date_from:'-30d',interval:'day',display:'ActionsLineGraph',events:events(names).map(e=>({...e,math:'total'})),properties:properties(),...extra}});
export function observabilityDashboards(){
 return [
  {name:'Leafhour · 故障',description:'仅记录脱敏后的故障类别与步骤。排除验收事件；详细问题见 Sentry。',insights:[
   trend('故障次数与类别',['request_failed','reader_load_failed','client_error','ingestion_failed','chat_failed']),
   trend('遇到故障的人数',['request_failed','reader_load_failed','client_error'],{events:events(['request_failed','reader_load_failed','client_error']).map(e=>({...e,math:'dau'}))}),
  ]},
  {name:'Leafhour · 首次阅读',description:'已开启使用情况统计的登录读者；正文可见才算打开。采集缺失不能直接推断流失。',insights:[
   {name:'从书房到正文',filters:{insight:'FUNNELS',date_from:'-30d',events:events(['library_opened','reader_open_requested','reader_content_visible']),properties:properties(),funnel_window_interval:1,funnel_window_interval_unit:'day',funnel_order_type:'ordered',display:'FunnelViz'}},
   trend('看到正文的读者',['reader_content_visible'],{events:events(['reader_content_visible']).map(e=>({...e,math:'dau'}))}),
  ]},
  {name:'Leafhour · 回来续读',description:'首次有效前台交互后按天观察 7 天回来阅读；未成熟窗口不当作流失，阅读不证明理解。恢复图只含已确认结果，未观察到的结果保持未知。',insights:[
   {name:'7 天回来阅读',filters:{insight:'RETENTION',date_from:'-30d',target_entity:{id:'reader_active',name:'reader_active',type:'events'},returning_entity:{id:'reader_active',name:'reader_active',type:'events'},retention_type:'retention_first_time',period:'Day',total_intervals:8,display:'RetentionTable',properties:properties()}},
   trend('续读位置恢复结果',['reader_resume_result'],{breakdown:'outcome',breakdown_type:'event'}),
  ]},
 ].map(d=>({...d,insights:d.insights.map(({name,filters})=>({name,query:insightQuery(filters)}))}));
}
function insightQuery(filters){
 const common={dateRange:{date_from:filters.date_from},properties:filters.properties,filterTestAccounts:true};
 const series=(filters.events||[]).map(({id,math})=>({kind:'EventsNode',event:id,...(math?{math}:{})}));
 let source;
 if(filters.insight==='FUNNELS')source={...common,kind:'FunnelsQuery',series,funnelsFilter:{funnelVizType:'steps',funnelOrderType:'ordered',funnelWindowInterval:1,funnelWindowIntervalUnit:'day'}};
 else if(filters.insight==='RETENTION')source={...common,kind:'RetentionQuery',retentionFilter:{targetEntity:filters.target_entity,returningEntity:filters.returning_entity,retentionType:'retention_first_time',period:'Day',totalIntervals:8,retentionReference:'total',cumulative:false}};
 else source={...common,kind:'TrendsQuery',series,interval:'day',trendsFilter:{display:'ActionsLineGraph'},...(filters.breakdown?{breakdownFilter:{breakdown:filters.breakdown,breakdown_type:'event'}}:{})};
 return {kind:'InsightVizNode',source};
}
async function listed(request,route){
 const rows=[];let next=route;
 for(let page=0;next&&page<30;page++){
  const data=await request(next);rows.push(...(data.results||[]));
  if(data.next){const u=new URL(data.next,'https://api.invalid');next=u.pathname+u.search;const match=next.match(/^\/api\/projects\/\d+(\/.*)$/);if(match)next=match[1];if(!next.startsWith(route.split('?')[0]))throw Error('Unexpected management pagination');}else next=null;
 }
 if(next)throw Error('Management result exceeds bounded pagination');
 return rows;
}
export async function upsertObservabilityDashboards(request){
 const dashboards=await listed(request,'/dashboards/'),savedInsights=await listed(request,'/insights/?limit=100'),results=[];
 for(const definition of observabilityDashboards()){
  const old=dashboards.find(d=>d.name===definition.name),body={name:definition.name,description:definition.description,pinned:true};
  const dashboard=await request(old?'/dashboards/'+old.id+'/':'/dashboards/',{method:old?'PATCH':'POST',body});
  const insights=[];
  for(const insight of definition.insights){
   const prior=savedInsights.find(i=>i.name===insight.name&&i.tags?.includes('leafhour-observability-v1'));
   const payload={...insight,saved:true,dashboards:[dashboard.id],tags:['leafhour-observability-v1']};
   const stored=await request(prior?'/insights/'+prior.id+'/':'/insights/',{method:prior?'PATCH':'POST',body:payload});insights.push(stored.id);
  }
  results.push({id:dashboard.id,name:definition.name,insights});
 }
 return results;
}
export async function configureFromEnvironment(env=process.env){
 const host=env.POSTHOG_API_HOST||'https://us.posthog.com',project=env.POSTHOG_PROJECT_ID,key=env.POSTHOG_PERSONAL_API_KEY;
 if(!['https://us.posthog.com','https://eu.posthog.com'].includes(host)||!/^\d+$/.test(project||'')||!key)throw Error('Provide regional POSTHOG_API_HOST, POSTHOG_PROJECT_ID and a scoped management key through the environment.');
 const request=async(route,{method='GET',body}={})=>{
  const response=await fetch(host+'/api/projects/'+project+route,{method,redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('PostHog management request failed with HTTP '+response.status);
  return response.json();
 };
 return upsertObservabilityDashboards(request);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.includes('--definitions'))console.log(JSON.stringify(observabilityDashboards(),null,2));
 else console.log(JSON.stringify(await configureFromEnvironment()));
}
