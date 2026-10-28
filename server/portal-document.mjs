// Serve the correct public shell on the first paint, even before modules load.
import {homeDocument,homeLocales} from '../app/home-locale.mjs';
import {publicDocumentHeader,publicNavigationMenu} from '../app/public-navigation.mjs';
const homeRoutes=new Map(homeLocales.map(row=>[row.route,row.code]));
export function portalDocument(source,pathname){
  const support=pathname.match(/^\/(?:(en|zh-hans|zh-hant|ja)\/)?(privacy|mcp)$/);
  if(support){
    const locale=({'zh-hans':'zh-Hans','zh-hant':'zh-Hant'})[support[1]]||support[1]||'en',kind=support[2];
    const languages=[['en','English'],['zh-Hans','简体中文'],['zh-Hant','繁體中文'],['ja','日本語']].map(([code,label])=>{
      const slug=({'zh-Hans':'zh-hans','zh-Hant':'zh-hant'})[code]||code;
      return `<a${code===locale?' aria-current="true"':''} href="${code==='en'?'/':'/'+slug+'/'}${kind}" lang="${code}" hreflang="${code}">${label}</a>`;
    }).join('');
    return source.replace('<!-- public-header -->',publicDocumentHeader({locale,current:kind}))
      .replace('<!-- public-menu -->',publicNavigationMenu({locale,languages}));
  }
  if(pathname==='/library')return libraryDocument(source);
  if(pathname==='/')return homeDocument(source,'en').replace(/(<a\b[^>]*\bhref=")(\/(?:library|read)(?:[?#][^"]*)?)(")/g,(_,before,href,after)=>before+href.replace(/(?:\?|&amp;)ui=en(?=#|$)/,'')+after);
  if(pathname==='/en')return homeDocument(source,'en');
  const locale=homeRoutes.get(pathname);
  return locale?homeDocument(source,locale):source;
}
// GET-192 canonical library shell: the complete safe English initial
// document, title, lang, loading and return entries render through the SAME
// shared server/static renderer as the English static shell, before any
// JavaScript meaningful control exists. No body hiding and no JS-only Chinese
// replacement after first paint.
function libraryDocument(source){
  const english=homeDocument(source,'en');
  const privateMetadata=english.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g,'').replace(/<link rel="alternate" hreflang="[^"]+" href="[^"]+">/g,'').replaceAll(' aria-current="true"','');
  const withRobots=privateMetadata.includes('<meta name="robots"')?privateMetadata.replace(/<meta name="robots"[^>]*>/,'<meta name="robots" content="noindex,nofollow">'):privateMetadata.replace('</head>','<meta name="robots" content="noindex,nofollow"></head>');
  return withRobots.replace(/<title>[^<]*<\/title>/,'<title>My reading room · Leafhour</title>')
    .replace('<link rel="canonical" href="https://leafhour.com/">','<link rel="canonical" href="https://leafhour.com/library">')
    .replace('<meta property="og:url" content="https://leafhour.com/">','<meta property="og:url" content="https://leafhour.com/library">')
    .replace('<body>','<body class="library-page">')
    .replace('<div id="home-view">','<div id="home-view" hidden>')
    .replace('<div id="library-view" hidden>','<div id="library-view">')
    .replaceAll('class="home-nav" href=','class="home-nav" hidden href=');
}
