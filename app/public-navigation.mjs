/* Primer Octicons GitHub mark
MIT License

Copyright (c) 2026 GitHub Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
// GitHub mark: Primer Octicons, MIT. https://github.com/primer/octicons/blob/main/icons/mark-github-16.svg
const slugs={en:'en','zh-Hans':'zh-hans','zh-Hant':'zh-hant',ja:'ja'};
const labels={en:{method:'How to read',agent:'Agent access',pricing:'Pricing',main:'Main navigation',close:'Close menu',open:'Open navigation menu',balance:'Points',appearance:'Appearance',language:'Language'},'zh-Hans':{method:'阅读的方法',agent:'Agent 接入',pricing:'价格',main:'主导航',close:'关闭菜单',open:'打开导航菜单',balance:'阅读点',appearance:'页面外观',language:'切换界面语言'},'zh-Hant':{method:'閱讀的方法',agent:'Agent 接入',pricing:'價格',main:'主導覽',close:'關閉選單',open:'開啟導覽選單',balance:'閱讀點',appearance:'頁面外觀',language:'語言'},ja:{method:'読み方',agent:'Agent 接続',pricing:'料金',main:'メインナビゲーション',close:'閉じる',open:'ナビゲーションメニューを開く',balance:'ポイント',appearance:'外観',language:'表示言語'}};
export const publicNavigationCopy=locale=>labels[locale]||labels.en;
export function publicPageHref(page,locale='en'){
 if(!['mcp','pricing'].includes(page))throw new TypeError('Unknown public destination');
 const slug=slugs[locale]||'en';return page==='mcp'&&slug==='en'?'/mcp':'/'+slug+'/'+page;
}
export const githubLink="<a class=\"home-nav public-github\" href=\"https://github.com/getyak/leafhour\" aria-label=\"GitHub\" target=\"_blank\" rel=\"noopener noreferrer\"><svg width=\"20\" height=\"20\" aria-hidden=\"true\" focusable=\"false\" fill=\"currentColor\" viewBox=\"0 0 16 16\"><path d=\"M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656\"/></svg><span class=\"github-wordmark\">GitHub</span></a>";
export const navigationGlobe='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="3.5" ry="8"/><path d="M4 12h16"/></svg>';
export function publicNavigation({locale='en',methodHref='#how',current=null}={}){
 const c=publicNavigationCopy(locale);
 return `<nav class="home-navigation" data-ui-aria-label="nav.main" aria-label="${c.main}"><a class="home-nav" data-ui="nav.method" href="${methodHref}">${c.method}</a><a class="home-nav" data-ui="nav.agent" data-public-page="mcp" href="${publicPageHref('mcp',locale)}"${current==='mcp'?' aria-current="page"':''}>${c.agent}</a><a class="home-nav" data-ui="nav.pricing" data-public-page="pricing" href="${publicPageHref('pricing',locale)}"${current==='pricing'?' aria-current="page"':''}>${c.pricing}</a>${githubLink}</nav>`;
}
const documentCopy={
 en:{home:'Leafhour home',room:'My reading room',compact:'Library',search:'Search & commands'},
 'zh-Hans':{home:'Leafhour 首页',room:'我的书房',compact:'书房',search:'搜索与命令'},
 'zh-Hant':{home:'Leafhour 首頁',room:'我的書房',compact:'書房',search:'搜尋與指令'},
 ja:{home:'Leafhour ホーム',room:'自分の書斎',compact:'書斎',search:'検索とコマンド'},
};
// Authored support documents keep their own content; the local server and
// hosted build both render this header from the current public destinations.
export function publicDocumentHeader({locale='en',current=null}={}){
 const c=documentCopy[locale]||documentCopy.en,nav=publicNavigationCopy(locale),home='/'+(slugs[locale]||'en');
 return `<header class="site-header public-document-header"><a class="brand" href="${home}" aria-label="${c.home}"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 32V20A13 13 0 0 1 21 7h11v11a14 14 0 0 1-14 14H8Z"/><path d="M16 23h7v-9"/></svg></span><span class="brand-name" lang="en">Leafhour</span></a>${publicNavigation({locale,methodHref:home+'#how',current})}<a class="home-account" id="account-button" href="/library?ui=${locale}" aria-label="${c.room}"><span class="public-account-full">${c.room}</span><span class="public-account-compact" aria-hidden="true">${c.compact}</span><span aria-hidden="true">↗</span></a><button class="public-search palette-entry" data-palette-open type="button" aria-label="${c.search}" title="${c.search}"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg></button><button class="home-menu-trigger" id="home-menu-trigger" type="button" aria-haspopup="dialog" aria-controls="home-menu" aria-expanded="false" aria-label="${nav.open}">${navigationGlobe}</button></header>`;
}
export function publicNavigationMenu({locale='en',languages=''}){
 const settings={en:'Interface language settings','zh-Hans':'界面语言设置','zh-Hant':'介面語言設定',ja:'表示言語の設定'}[locale]||'Interface language settings';
 languages+='<a href="/library?settings=appearance" data-ui="ui.language.settings">'+settings+'</a>';
 const c=publicNavigationCopy(locale);
 return `<dialog autofocus id="home-menu" class="home-menu-sheet" aria-labelledby="home-menu-title"><button class="dialog-close" data-close="home-menu" type="button" aria-label="${c.close}">×</button><h2 id="home-menu-title" data-ui="nav.main">${c.main}</h2><nav class="home-menu-links" id="home-menu-links" aria-label="${c.main}"></nav><div class="home-menu-languages" id="home-menu-languages"><span class="home-languages" aria-label="${c.language}">${languages}</span></div></dialog>`;
}
