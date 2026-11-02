// Shared by source selection, resumable uploads and deferred extraction.
// Expanded book/archive limits remain separate from original file capacity.
export function documentByteLimit(filename){
 if(typeof filename==='string'&&/\.pdf$/i.test(filename))return 256*1024*1024;
 if(typeof filename==='string'&&/\.(txt|md|markdown)$/i.test(filename))return 64*1024*1024;
 return 20*1024*1024;
}
export const documentLimitMessage='PDF 最多 256 MB，EPUB 最多 20 MB，TXT 与 Markdown 最多 64 MB';
