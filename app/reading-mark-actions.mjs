import {normalizeReadingMilestone} from './reading-session-record.mjs';
export function createReadingMarkActions({book,load,save,send}){
  const saved=load();if(!Array.isArray(saved)||saved.length>100)throw Error('本机待确认的阅读标记无法读取，原数据已保留。');let rows=saved.map(m=>normalizeReadingMilestone(m,book)),busy=new Set();
  const key=mark=>mark.chapterId||'book',persist=next=>{save(structuredClone(next));rows=next;};
  const refresh=()=>{rows=load().map(m=>normalizeReadingMilestone(m,book));};
  return {pending(chapterId){refresh();const row=rows.find(m=>key(m)===(chapterId||'book'));return row?structuredClone(row):null;},
    async submit(type,chapterId){const context=chapterId||'book';if(busy.has(context))throw Error('这次标记正在保存。');busy.add(context);try{
      refresh();let mark=rows.find(m=>key(m)===context);if(!mark){if(rows.length>=100)throw Error('待确认标记较多，请先重试。');mark=normalizeReadingMilestone({id:crypto.randomUUID(),type,...(chapterId?{chapterId}:{}),createdAt:new Date().toISOString()},book);persist([...rows,mark]);}
      const receipt=await send(mark);if(receipt?.id!==mark.id||receipt.type!==mark.type||receipt.chapterId!==mark.chapterId)throw Error('服务尚未确认这次标记，原提交仍保留。');persist(rows.filter(m=>m.id!==mark.id));return receipt;
    }finally{busy.delete(context);}}
  };
}
