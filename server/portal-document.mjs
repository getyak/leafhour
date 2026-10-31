// Serve the correct public shell on the first paint, even before modules load.
import {homeDocument,homeLocales} from '../app/home-locale.mjs';
import {publicDocumentHeader,publicNavigationMenu} from '../app/public-navigation.mjs';
import {withoutUiParam} from '../app/ui-locale-codec.mjs';
import {firstPaintCatalogue,localizeOwnedUiHtml,stampInitialUiDocument} from './ui-first-paint.mjs';
import {paperCompanionHtml} from '../app/paper-companion.mjs';
import {libraryArrivalPresentation} from '../app/arrival-excerpt.mjs';
const escapeArrival=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function arrivalShell(context,locale){
 const c=firstPaintCatalogue(locale),copy=libraryArrivalPresentation(locale),greeting=context==='library'?'arrival.greeting.library':context==='notes'?'ws.notesTitle':'ws.calendarTitle';
 return `<div data-reading-arrival="${context}" class="reading-arrival arrival-library" lang="${locale}">${paperCompanionHtml()}<p class="arrival-greeting" data-ui="${greeting}">${escapeArrival(c[greeting])}</p><p class="arrival-context" data-ui="arrival.context.library">${escapeArrival(c['arrival.context.library'])}</p><blockquote class="arrival-quote" lang="${copy.lang}">${escapeArrival(copy.text)}</blockquote><p class="arrival-original" lang="en"${copy.original?'':' hidden'}>${escapeArrival(copy.original)}</p><p class="arrival-source" lang="${copy.lang}">${escapeArrival(copy.source)}<span class="arrival-provenance" data-ui="${copy.provenanceId}">${escapeArrival(c[copy.provenanceId])}</span></p><p class="arrival-status" role="status" data-ui="arrival.status.${context}">${escapeArrival(c['arrival.status.'+context])}</p></div>`;
}
const homeRoutes=new Map(homeLocales.map(row=>[row.route,row.code]));
export function portalDocument(source,pathname,decision){
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
  if(pathname==='/library')return libraryDocument(source,decision);
  if(pathname==='/'){if(decision)return stampInitialUiDocument(initialNativeLinks(homeDocument(source,decision.locale),decision),decision);return homeDocument(source,'en').replace(/(<a\b[^>]*\bhref=")(\/(?:library|read)(?:[?#][^"]*)?)(")/g,(_,before,href,after)=>before+href.replace(/(?:\?|&amp;)ui=en(?=#|$)/,'')+after);}
  if(pathname==='/en')return homeDocument(source,'en');
  const locale=homeRoutes.get(pathname);
  return locale?homeDocument(source,locale):source;
}
// The selected language owns the initial shell before modules run. The same
// renderer serves hosted/self-hosted HTML, with private metadata removed.
function libraryDocument(source,decision={locale:'en',source:'browser',preference:null}){
  if(!decision)decision={locale:'en',source:'browser',preference:null};
  const librarySource=source.replace(/<script\s+type="module"\s+src="\/home-(?:motion|atmosphere|sample)\.mjs"\s*><\/script>/g,'').replace(/<link\s+rel="stylesheet"\s+href="\/home-(?:motion|atmosphere|sample|story)\.css"\s*>/g,'');
  const localized=homeDocument(librarySource,decision.locale);
  const privateMetadata=localized.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g,'').replace(/<link rel="alternate" hreflang="[^"]+" href="[^"]+">/g,'').replaceAll(' aria-current="true"','');
  const withRobots=privateMetadata.includes('<meta name="robots"')?privateMetadata.replace(/<meta name="robots"[^>]*>/,'<meta name="robots" content="noindex,nofollow">'):privateMetadata.replace('</head>','<meta name="robots" content="noindex,nofollow"></head>');
  const rendered=withRobots.replace(/<title>[^<]*<\/title>/,'<title>'+firstPaintCatalogue(decision.locale)['portal.title.library']+'</title>')
    .replace(/<link rel="canonical" href="[^"]+">/,'<link rel="canonical" href="https://leafhour.com/library">')
    .replace(/<meta property="og:url" content="[^"]+">/,'<meta property="og:url" content="https://leafhour.com/library">')
    .replace('<body>','<body class="library-page">')
    .replace('<div id="home-view">','<div id="home-view" hidden>')
    .replace('<div id="library-view" hidden>','<div id="library-view">')
    .replaceAll('class="home-nav" href=','class="home-nav" hidden href=');
  const workspace=['calendar','notes'].includes(decision.workspace)?rendered.replace('<body class="library-page">','<body class="library-page workspace-active">').replace('<div id="library-view">','<div id="library-view" hidden>').replace(/(<section\b[^>]*\bid="reading-workspace"[^>]*?)\s+hidden\b/,'$1').replace(/<title>[^<]*<\/title>/,'<title>'+firstPaintCatalogue(decision.locale)[decision.workspace==='notes'?'ws.notesTitle':'ws.calendarTitle']+'</title>'):rendered;
  const arrivals=workspace.replace(/<div data-reading-arrival="(library|calendar)"><p[^>]*>[\s\S]*?<\/p><\/div>/g,(_,context)=>arrivalShell(context==='library'?'library':decision.workspace||'calendar',decision.locale));
  const native=initialNativeLinks(arrivals,decision);
  return stampInitialUiDocument(localizeOwnedUiHtml(native,decision.locale),decision);
}

function initialNativeLinks(html,decision){return decision.source==='browser'||decision.preference==='system'?html.replace(/(<a\b[^>]*\bhref=")(\/(?:library|read)(?:[?#][^"]*)?)(")/g,(_,before,href,after)=>before+withoutUiParam(href.replaceAll('&amp;','&')).replaceAll('&','&amp;')+after):html;}
