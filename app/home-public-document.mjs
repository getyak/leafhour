// Public marketing delivery must not boot the private-library application.
// The source template remains shared; /library retains its original assets.
export function publicHomeDocument(source){
 if(!source.includes('id="product-stage"'))return source;
 const keep=new Set(['/home-entry-bootstrap.mjs','/home-sample.mjs','/home-experience.mjs']);
 return source
  .replace(/<div id="library-view" hidden>[\s\S]*?<\/main>/,'</main>')
  .replace(/<dialog\b[^>]*\bid="(?:auth|upload)-dialog"[\s\S]*?<\/dialog>/g,'')
  .replace(/<div class="library-side-controls library-only">[\s\S]*?(?=<a class="home-account")/,'')
  .replace('href="/fonts/newsreader/newsreader-var.woff2"','href="/fonts/newsreader/newsreader-home.woff2"')
  .replace(/<link\s+rel="stylesheet"\s+href="[^"]+"[^>]*>/g,'')
  .replace(/<script\s+type="module"\s+src="([^"]+)"\s*><\/script>/g,(tag,url)=>keep.has(url)?tag:'')
  .replace('</head>','<link rel="stylesheet" href="/home-public.css"><script type="module" src="/home-public.mjs"></script></head>');
}
