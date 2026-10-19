const legacyDescriptions=/* @__PURE__ */Object.freeze({
 'source.description.epub':'EPUB 原文保留在自己的书房，尚未逐段校对。',
 'source.description.epubNavigation':'章节依据 EPUB 目录及源文件锚点整理。',
 'source.description.epubSpine':'缺少可用目录，按 EPUB 阅读顺序整理片段，不代表原书章节。',
 'source.description.epubAnchors':'保留章节源文件与元素定位，不虚构页码。',
 'source.description.private':'原文保留在自己的书房。',
 'source.description.paddle':'本书由 PaddleOCR 官方服务识别，尚未逐段校对。',
 'source.description.mixed':'可读文字直接提取；需要识别的扫描页由 PaddleOCR 官方服务识别，尚未逐段校对。',
 'source.description.native':'文字直接从 PDF 的文字层提取，尚未逐段校对。换行和段落可能与原排版不同。',
 'source.description.pages':'段落保留 PDF 页码；',
 'source.description.outline':'章节依据 PDF 书签整理。',
 'source.description.headings':'章节依据识别到的标题整理，建议对照原目录核对。',
 'source.description.grouped':'阅读片段由系统自动分组，不代表原书章节。'
});
// A UI caches these provenance IDs during a real book update. There is no
// locale state here, and source metadata is never rewritten or used as an ID.
export function sourceDescriptionMessages(book){
 const source=book.source||{},pdf=source.format==='pdf';
 if(source.format==='epub')return ['source.description.epub',source.structure==='epub_navigation'?'source.description.epubNavigation':'source.description.epubSpine','source.description.epubAnchors'];
 return [!pdf?'source.description.private':source.processor==='PaddleOCR-VL-1.6'?'source.description.paddle':source.processor==='native+paddle-auto-v1'?'source.description.mixed':'source.description.native',...(pdf?['source.description.pages']:[]),source.structure==='pdf_outline'?'source.description.outline':source.structure==='source_headings'?'source.description.headings':'source.description.grouped'];
}
export function importSourceDescription(book,format=(id,params,fallback)=>fallback){
 return sourceDescriptionMessages(book).map(id=>format(id,{},legacyDescriptions[id])).join('');
}
