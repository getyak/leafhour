// Serve the correct public shell on the first paint, even before modules load.
export function portalDocument(source,pathname){
  if(pathname!=='/library')return source;
  return source.replace(/<title>[^<]*<\/title>/,'<title>我的书房 · 循页 Page by Page</title>')
    .replace('<body>','<body class="library-page">')
    .replace('<div id="home-view">','<div id="home-view" hidden>')
    .replace('<div id="library-view" hidden>','<div id="library-view">')
    .replaceAll('class="home-nav" href=','class="home-nav" hidden href=');
}
