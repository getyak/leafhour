// These boundaries apply only to the bundled, source-checked editions.
// Imported private books keep their honest automatic grouping.
const roman=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
const ordinal=['FIRST','SECOND','THIRD','FOURTH','FIFTH','SIXTH','SEVENTH','EIGHTH','NINTH','TENTH','ELEVENTH','TWELFTH'];
const aliceTitles=['掉进兔子洞','泪水池','绕圈赛跑与长故事','白兔派来小比尔','毛毛虫的建议','小猪与胡椒','疯狂的茶会','王后的槌球场','假海龟的故事','龙虾四对舞','谁偷走了馅饼？','爱丽丝的证词'];
const waldenTitles=[['Economy','经济'],['Where I Lived, and What I Lived For','我生活的地方，以及我为何而生活'],['Reading','阅读'],['Sounds','声音'],['Solitude','独处'],['Visitors','访客'],['The Bean-Field','豆田'],['The Village','村庄'],['The Ponds','湖泊'],['Baker Farm','贝克农场'],['Higher Laws','更高的法则'],['Brute Neighbors','动物邻居'],['House-Warming','暖屋'],['Former Inhabitants and Winter Visitors','昔日居民与冬日访客'],['Winter Animals','冬日动物'],['The Pond in Winter','冬日的湖'],['Spring','春天'],['Conclusion','结语']];

export function applyCatalogChapters(book){
  const paragraphs=book.sections.flatMap(s=>s.paragraphs),starts=[];let expected;
  if(book.bookId==='gutenberg-alice'){
    expected=12;for(let i=0;i<paragraphs.length;i++){const match=paragraphs[i].original.match(/^CHAPTER ([IVX]+)\.\s+(.{1,120})$/);if(match&&roman[starts.length]===match[1])starts.push({index:i,kind:'body',number:starts.length+1,title:{zh:aliceTitles[starts.length],en:match[2]}});}
  }else if(book.bookId==='gutenberg-meditations'){
    expected=12;for(let i=0;i<paragraphs.length;i++){if(paragraphs[i].original==='THE '+ordinal[starts.length]+' BOOK')starts.push({index:i,kind:'body',number:starts.length+1,title:{zh:'第 '+(starts.length+1)+' 卷',en:paragraphs[i].original}});}
  }else if(book.bookId==='gutenberg-walden'){
    expected=18;for(let i=0;i<paragraphs.length;i++){const title=waldenTitles[starts.length];if(title&&paragraphs[i].original===title[0])starts.push({index:i,kind:'body',number:starts.length+1,title:{zh:title[1],en:title[0]}});}
  }else return book;
  if(starts.length!==expected)return {...book,source:{...book.source,chapterDetection:'incomplete'}};
  const firstBody=starts[0];
  if(book.bookId==='gutenberg-meditations')for(const [heading,zh]of [['APPENDIX','附录与注释'],['GLOSSARY','术语表']]){const index=paragraphs.findIndex((p,i)=>i>starts.at(-1).index&&p.original===heading);if(index>=0)starts.push({index,kind:'appendix',title:{zh,en:heading}});}
  if(book.bookId==='gutenberg-walden'){const index=paragraphs.findIndex((p,i)=>i>starts.at(-1).index&&p.original==='ON THE DUTY OF CIVIL DISOBEDIENCE');if(index>=0)starts.push({index,kind:'appendix',title:{zh:'论公民的不服从义务',en:paragraphs[index].original}});}
  if(firstBody.index>0)starts.unshift({index:0,kind:'frontmatter',title:{zh:'出版说明与前言',en:'Front matter'}});
  const chapters=[],sections=[];
  for(let i=0;i<starts.length;i++){
    const start=starts[i],id=start.kind==='body'?'ch'+String(start.number).padStart(2,'0'):start.kind==='frontmatter'?'frontmatter':'appendix-'+(i+1),rows=paragraphs.slice(start.index,starts[i+1]?.index||paragraphs.length).map(p=>({...p}));
    if(start.kind!=='frontmatter')rows[0].kind='source_heading';
    chapters.push({id,number:start.number||0,kind:start.kind,title:start.title,titleAttribution:'editorial_navigation',startPassageId:(start.kind==='frontmatter'?rows[0]:rows[1]||rows[0]).id});
    sections.push({number:i+1,chapterId:id,title:start.title.zh,paragraphs:rows});
  }
  return {...book,chapters,sections,source:{...book.source,structure:'source_chapters',structureVersion:'catalog-chapters-1',chapterBoundaryReview:'source_headings_checked'},readingStart:{chapterId:'ch01',passageId:chapters.find(c=>c.id==='ch01').startPassageId}};
}

export function alignReadingPosition(book,position){
  if(!position)return null;
  const section=book.sections.find(s=>s.paragraphs.some(p=>p.id===position.passageId));
  if(!section)return null;
  return {...position,chapterId:section.chapterId};
}
