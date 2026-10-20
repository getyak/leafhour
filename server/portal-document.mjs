// Serve the correct public shell on the first paint, even before modules load.
import {homeDocument,homeLocales} from '../app/home-locale.mjs';
const homeRoutes=new Map(homeLocales.map(row=>[row.route,row.code]));
export function portalDocument(source,pathname){
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
