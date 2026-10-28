import {createOfflineBookStore} from './offline-book-store.mjs';

const copy={
 en:{label:'Local reading',title:'Saved on this device',description:'Open the books and chapters already saved here.',loading:'Opening saved books…',empty:'No books are saved on this device yet.',unavailable:'Saved books could not open. Reconnect and try again.',online:'Return to the reading room when connected',complete:'Saved in full',chapters:(loaded,total)=>`${loaded} of ${total} chapters saved`,untitled:'Untitled book',clear:'Remove books from this device',clearHelp:'Removes saved books here. Notes and drafts are kept.',clearing:'Removing saved books…',cleared:'Books removed from this device.',clearFailed:'Local reading is closed, but some book files could not be removed.'},
 'zh-Hans':{label:'本机阅读',title:'已保存到此设备',description:'打开已经保存的书籍和章节。',loading:'正在打开本机书籍…',empty:'此设备还没有保存书籍。',unavailable:'暂时无法打开本机书籍，请联网后重试。',online:'联网后返回书房',complete:'已保存整本',chapters:(loaded,total)=>`已保存 ${loaded} / ${total} 章`,untitled:'未命名书籍',clear:'清除本机书籍',clearHelp:'清除已保存的书籍，保留笔记和草稿。',clearing:'正在清除本机书籍…',cleared:'已清除本机书籍。',clearFailed:'本机阅读已关闭，但部分书籍文件未能清除。'},
 'zh-Hant':{label:'本機閱讀',title:'已儲存到此裝置',description:'開啟已經儲存的書籍和章節。',loading:'正在開啟本機書籍…',empty:'此裝置還沒有儲存書籍。',unavailable:'暫時無法開啟本機書籍，請連線後重試。',online:'連線後返回書房',complete:'已儲存整本',chapters:(loaded,total)=>`已儲存 ${loaded} / ${total} 章`,untitled:'未命名書籍',clear:'清除本機書籍',clearHelp:'清除已儲存的書籍，保留筆記和草稿。',clearing:'正在清除本機書籍…',cleared:'已清除本機書籍。',clearFailed:'本機閱讀已關閉，但部分書籍檔案未能清除。'},
 ja:{label:'ローカル読書',title:'この端末に保存した本',description:'保存済みの本と章を開けます。',loading:'保存した本を開いています…',empty:'この端末にはまだ本が保存されていません。',unavailable:'保存した本を開けませんでした。接続してからもう一度お試しください。',online:'接続後に書斎へ戻る',complete:'全章保存済み',chapters:(loaded,total)=>`${total} 章中 ${loaded} 章を保存済み`,untitled:'無題の本',clear:'この端末から本を削除',clearHelp:'保存した本を削除します。メモと下書きは残ります。',clearing:'保存した本を削除しています…',cleared:'この端末から本を削除しました。',clearFailed:'ローカル読書を閉じましたが、一部の本のファイルを削除できませんでした。'}
};
const locale=new URL(location.href).searchParams.get('ui')||navigator.language||'en';
const code=Object.hasOwn(copy,locale)?locale:/^zh-(?:TW|HK|Hant)/i.test(locale)?'zh-Hant':/^zh/i.test(locale)?'zh-Hans':/^ja/i.test(locale)?'ja':'en',c=copy[code];
document.documentElement.lang=code;document.title='Leafhour · '+c.title;
for(const key of ['label','title','description','online','clear'])document.getElementById('offline-'+key).textContent=c[key];
document.getElementById('offline-clear-help').textContent=c.clearHelp;
const status=document.getElementById('offline-status'),list=document.getElementById('offline-books'),clearButton=document.getElementById('offline-clear');status.textContent=c.loading;
let store,clearState=null;
const revoke=()=>{if(!store?.owner()){list.replaceChildren();clearButton.disabled=true;if(!clearState)status.textContent=c.empty;}};
window.addEventListener('storage',revoke);window.addEventListener('pageshow',revoke);
clearButton.addEventListener('click',async()=>{
 if(!store?.owner()||clearState)return;
 clearState='clearing';clearButton.disabled=true;
 try{
  const clearing=store.clear();revoke();status.textContent=c.clearing;
  await clearing;clearState='cleared';status.textContent=c.cleared;
 }catch{revoke();clearState='failed';status.textContent=c.clearFailed;}
});
try{
 store=createOfflineBookStore();const owner=store.owner();clearButton.disabled=!owner;const books=owner?await store.list():[];
 if(!clearState&&store.owner()===owner){
  for(const book of books){
   if(!book.loaded)continue;
   const item=document.createElement('li'),link=document.createElement('a'),range=document.createElement('p');
   link.className='text-link';link.href='/read?book='+encodeURIComponent(book.bookId)+'&ui='+encodeURIComponent(code);
   link.textContent=typeof book.title==='string'?book.title:book.title?.[code]||book.title?.zh||book.title?.en||c.untitled;
   range.textContent=book.complete?c.complete:c.chapters(book.loaded,book.total);item.append(link,range);list.append(item);
  }
  status.textContent=list.children.length?'':c.empty;
 }
}catch{if(!clearState)status.textContent=store&&!store.owner()?c.empty:c.unavailable;}
