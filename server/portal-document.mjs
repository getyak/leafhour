// Serve the correct public shell on the first paint, even before modules load.
import {homeDocument,homeLocales} from '../app/home-locale.mjs';
const homeRoutes=new Map(homeLocales.map(row=>[row.route,row.code]));
export function portalDocument(source,pathname){
  if(pathname==='/library')return libraryDocument(source);
  if(pathname==='/en')return homeDocument(source,'en');
  const locale=homeRoutes.get(pathname);
  return locale?homeDocument(source,locale):source;
}
function libraryDocument(source){
  source=source.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g,'').replace(/<link rel="alternate" hreflang="[^"]+" href="[^"]+">/g,'');
  const privateMetadata=source.includes('<meta name="robots"')?source.replace(/<meta name="robots"[^>]*>/,'<meta name="robots" content="noindex,nofollow">'):source.replace('</head>','<meta name="robots" content="noindex,nofollow"></head>');
  return privateMetadata.replace(/<title>[^<]*<\/title>/,'<title>我的书房 · Leafhour</title>')
    .replace('<link rel="canonical" href="https://leafhour.com/">','<link rel="canonical" href="https://leafhour.com/library">')
    .replace('<meta property="og:url" content="https://leafhour.com/">','<meta property="og:url" content="https://leafhour.com/library">')
    .replace('<body>','<body class="library-page">')
    .replace('<div id="home-view">','<div id="home-view" hidden>')
    .replace('<div id="library-view" hidden>','<div id="library-view">')
    .replaceAll('class="home-nav" href=','class="home-nav" hidden href=');
}
