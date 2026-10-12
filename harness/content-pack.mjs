import {createHash} from 'node:crypto';

const digest=s=>createHash('sha256').update(s).digest('hex');
const sentences=text=>String(text||'').match(/[^。！？.!?]+[。！？.!?]?/g)?.map(s=>s.trim()).filter(Boolean)||[];
const first=text=>sentences(text)[0]||String(text||'');

export function buildExperiencePack(book){
 const xrays={};
 for(const section of book.sections)for(const p of section.paragraphs){
  if(typeof p.original!=='string'||!p.original.trim())continue;
  const parts=sentences(p.original).slice(0,3),roles=[];
  for(let i=0;i<parts.length;i++){
   const quote=parts[i],kind=/^(if|unless|only when)\b/i.test(quote)?'condition':/\b(but|however|on the contrary|although)\b/i.test(quote)?'contrast':/\b(because|therefore|thus|for this reason|it follows)\b/i.test(quote)?'reason':'statement';
   const labels={condition:'条件关系',contrast:'转折／对照',reason:'理由／推导线索',statement:i===0?'作者表述':'承接表述'};
   const translated=variant=>{const text=p.translations?.[variant]?.text||'';return sentences(text)[Math.min(i,sentences(text).length-1)]||text;};
   roles.push({kind,label:labels[kind],summary:kind==='statement'?'核对作者在这一句明确说了什么。':kind==='condition'?'注意条件成立的范围；不要省略“如果”。':kind==='contrast'?'对照前后两句，保留作者的转折。':'连接词提示理由或推导；是否支持结论仍需核对。',sourceRef:{passageId:p.id,quote},quotes:{en:quote,literal:translated('literal'),interpretive:translated('interpretive')}});
  }
  xrays[p.id]={passageId:p.id,sourceHash:digest(p.original),basis:'text-structure',attribution:'editorial',review:'draft',roles};
  const specific={
   'fig-1986-s001-p002':{split:true,labels:['有限游戏：目的','无限游戏：目的'],notes:['把胜负作为本次参与的目的。','把游戏能继续作为参与的目的。']},
   'fig-1986-s032-p001':{indices:[2,4],labels:['共同体条件','关系中的自我'],notes:['作者把自我与共同体联系起来。','自我在关系中形成，是这里进一步的主张。']},
   'fig-1986-s051-p001':{indices:[0,1,2],labels:['主体主张','思考的主体','行动的主体'],notes:['先看作者怎样界定“我”。','保留“我”与心智之间的区分。','继续核对整体主体与意志的关系。']},
   'fig-1986-s063-p001':{indices:[0,1,2],labels:['主张','边界的参照','推到外部'],notes:['有限游戏发生在世界中。','有界限，便需要它所相对的范围。','这是作者据此提出的外部。']},
   'fig-1986-s070-p001':{indices:[0,2],labels:['不可言说','文化的对照'],notes:['先保留作者赋予自然的这个含义。','这里从文化的回应来描述不可言说。']},
   'fig-1986-s080-p001':{indices:[0,4],labels:['动机主张','社会结果'],notes:['作者先提出社会动机。','这一句收回到特定的社会结果，仍可追问其论据。']},
   'fig-1986-s094-p001':{indices:[0,1],labels:['神话与解释','重新打开话语'],notes:['作者同时保留激发解释与不被解释封闭。','对照解释的收纳与神话带回的沉默。']}
  }[p.id];
  if(book.bookId==='finite-infinite-games-1986'&&specific){
   const en=specific.split?p.original.split(/,\s+/).map(s=>s.trim()):sentences(p.original),localized=v=>specific.split?String(p.translations?.[v]?.text||'').split(/[，；]/).map(s=>s.trim()):sentences(p.translations?.[v]?.text||'');
   const indices=specific.indices||[0,1];
   const rich=indices.map((j,i)=>({kind:'argument',label:specific.labels[i],summary:specific.notes[i],sourceRef:{passageId:p.id,quote:en[j]},quotes:{en:en[j],literal:localized('literal')[j]||first(p.translations?.literal?.text),interpretive:localized('interpretive')[j]||first(p.translations?.interpretive?.text)}})).filter(r=>r.sourceRef.quote);
   if(rich.length)xrays[p.id]={...xrays[p.id],basis:'编辑骨架 · 待复核',roles:rich};
  }
 }
 const plans={
  ch01:{id:'fig-1986-s001-p002',prompt:'持续得越久，就越接近无限游戏吗？',a:'我倾向于这样理解',b:'我觉得要看玩的目的',author:'b',text:'本段用取胜与继续游戏的目的来区分。时间很长，仍不能单凭年限决定它是哪一种游戏。'},
  ch02:{id:'fig-1986-s032-p001',prompt:'先有一个完整的“我”，然后才与他人发生关系？',a:'我倾向于这样理解',b:'“我”也在关系中形成',author:'b',text:'作者把自我放在共同体与关系中讨论。这是他的哲学主张，你可以继续追问它是否覆盖独处经验。'},
  ch03:{id:'fig-1986-s051-p001',prompt:'心智、意志和神经系统，各自就是思考、行动、感受的主体？',a:'我倾向于这样理解',b:'主体仍是作为整体的我',author:'b',text:'本段坚持“我”是活动的主体。这种说法与机制解释如何相容，是可以保留的疑问。'},
  ch04:{id:'fig-1986-s063-p001',prompt:'一场有限游戏的边界，只由游戏本身决定？',a:'我倾向于这样理解',b:'边界也相对于更大的世界',author:'b',text:'作者指出，时间、人数与空间的限制需要一个更大的范围作为参照。请核对他怎样论证这个外部。'},
  ch05:{id:'fig-1986-s070-p001',prompt:'自然会以自己的声音回应人类文化？',a:'我倾向于这样理解',b:'自然并不这样回应',author:'b',text:'这里的自然“没有声音”是作者讨论不可言说的表述，不是在否认自然界存在声响。'},
  ch06:{id:'fig-1986-s080-p001',prompt:'控制自然，追求的主要只是自然过程的结果？',a:'我倾向于这样理解',b:'背后还指向社会结果',author:'b',text:'本段把支配自然的目的指向社会结果。它是一项作者主张，不能靠一个技术案例就证明普遍成立。'},
  ch07:{id:'fig-1986-s094-p001',prompt:'解释足够完整以后，神话就被解释消除了？',a:'我倾向于这样理解',b:'神话仍让解释保持开放',author:'b',text:'作者写神话激发解释，却不接受解释的封闭。这一表述可以继续核对，不必立即认同。'}
 };
 const cards=[];
 if(book.bookId==='finite-infinite-games-1986')for(const c of book.chapters){
  const plan=plans[c.id],p=book.sections.flatMap(s=>s.paragraphs).find(p=>p.id===plan?.id);if(!p)continue;
  const directlySupporting={ch02:[2,4],ch03:[1,2,3],ch06:[0,4],ch07:[0]};
  const pieces=sentences(p.original),references=(directlySupporting[c.id]||[0]).map(i=>pieces[i]).filter(Boolean).map(quote=>({passageId:p.id,quote}));
  const ref=references[0]||{passageId:p.id,quote:first(p.original)};
  cards.push({id:'stance-'+c.id+'-1',chapterId:c.id,triggerPassageId:p.id,prompt:plan.prompt,attribution:'editorial',review:'draft',choices:[{id:'a',label:plan.a},{id:'b',label:plan.b},{id:'unsure',label:'我还不确定'}],responses:{a:{tone:plan.author==='a'?'strengthen':'challenge',title:plan.author==='a'?'原文与这个判断相近':'原文挑战了这个判断',text:plan.text,sourceRefs:references.length?references:[ref]},b:{tone:plan.author==='b'?'strengthen':'challenge',title:plan.author==='b'?'原文与这个判断相近':'原文挑战了这个判断',text:plan.text,sourceRefs:references.length?references:[ref]},unsure:{tone:'open',title:'先保留这个问题',text:plan.text,sourceRefs:references.length?references:[ref]}},echoPassageIds:[p.id]});
 }
 const sourceHashes=Object.fromEntries(book.sections.flatMap(s=>s.paragraphs).filter(p=>typeof p.original==='string').map(p=>[p.id,digest(p.original)]));
 return {kind:'marginalia-experience-pack',schemaVersion:1,bookId:book.bookId,contentVersion:book.contentVersion,sourceHashes,xrays,cards,metadata:{sourceReview:'extracted_unreviewed',semanticReview:'draft',scope:'source-derived structural cues, not inferred full argument',generatedAt:new Date().toISOString()}};
}
