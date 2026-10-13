export function createUploadState(){
  let file=null,busy=false;
  return {
    get file(){return file;},get busy(){return busy;},
    select(candidate){
      if(busy)return false;file=null;
      if(!candidate||!Number.isFinite(candidate.size)||candidate.size<=0)throw Error('文件中没有内容，请选择另一份文件。');
      if(candidate.size>20*1024*1024)throw Error('文件超过 20 MB，请按章节拆分。');
      if(typeof candidate.name!=='string'||!candidate.name.trim()||candidate.name.length>240||!/\.(pdf|txt|md)$/i.test(candidate.name))throw Error('目前支持 PDF、TXT 和 Markdown。请重新选择文件。');
      file=candidate;return true;
    },
    begin(){if(busy)throw Error('文件正在处理，请稍等。');if(!file)throw Error('请先选择文件。');busy=true;return file;},
    finish(){busy=false;},reset(){if(!busy)file=null;}
  };
}
