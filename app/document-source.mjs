export function importSourceDescription(book){
 const source=book.source||{},pdf=source.format==='pdf';
 if(source.format==='epub')return 'EPUB 原文保留在自己的书房，尚未逐段校对。'+(source.structure==='epub_navigation'?'章节依据 EPUB 目录及源文件锚点整理。':'缺少可用目录，按 EPUB 阅读顺序整理片段，不代表原书章节。')+'保留章节源文件与元素定位，不虚构页码。';
 const extraction=!pdf?'原文保留在自己的书房。':source.processor==='PaddleOCR-VL-1.6'?'本书由 PaddleOCR 官方服务识别，尚未逐段校对。':source.processor==='native+paddle-auto-v1'?'可读文字直接提取；需要识别的扫描页由 PaddleOCR 官方服务识别，尚未逐段校对。':'文字直接从 PDF 的文字层提取，尚未逐段校对。换行和段落可能与原排版不同。';
 const structure=source.structure==='pdf_outline'?'章节依据 PDF 书签整理。':source.structure==='source_headings'?'章节依据识别到的标题整理，建议对照原目录核对。':'阅读片段由系统自动分组，不代表原书章节。';
 return extraction+(pdf?'段落保留 PDF 页码；':'')+structure;
}
