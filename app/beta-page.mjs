import {publicDocumentHeader,publicNavigationMenu} from './public-navigation.mjs';
import {betaChannels,publicTestFlightUrl} from './beta-channel.mjs';

const slugs={en:'en','zh-Hans':'zh-hans','zh-Hant':'zh-hant',ja:'ja'};
const languageNames={en:'English','zh-Hans':'简体中文','zh-Hant':'繁體中文',ja:'日本語'};
const copy={
  "en": {
    "title": "Join the beta",
    "description": "Read on the web. Take Leafhour with you on iPhone. Join the beta and tell us how it feels.",
    "heading": "Make room for\nyour next book.",
    "intro": "Leafhour is in beta. Bring a book you want to spend time with, try reading, listening and asking questions, and tell us what could work better.",
    "ios": "Leafhour for iPhone",
    "iosBody": "A reading room to carry with you. Read, listen sentence by sentence, compare translations and ask about the passage in front of you.",
    "install": "Install with TestFlight",
    "unavailable": "iOS installation is being checked",
    "unavailableBody": "The public installation link is not available yet. You can read on the web now or email us for help.",
    "requirement": "iOS 17 or later · Beta version",
    "steps": [
      "Install Apple’s TestFlight app.",
      "Open the Leafhour invitation and tap Accept.",
      "Install Leafhour and open your first book."
    ],
    "testflight": "Get TestFlight",
    "iosCaption": "Actual iPhone reading interface · public-domain sample",
    "webTitle": "Start with a few pages.",
    "webBody": "Open a sample in your browser. Compare the original and translation, then continue into your own reading room when you are ready.",
    "trial": "Read a sample",
    "room": "Open my reading room",
    "webNote": "No account needed for sample reading.",
    "webCaption": "Actual Web reader · public-domain sample",
    "expectTitle": "Before you begin",
    "expect": [
      [
        "Still taking shape",
        "Some interactions may change, and you may run into rough edges. Your specific feedback helps us decide what to fix."
      ],
      [
        "Reading stays free",
        "During beta, reading and AI features are free, with no usage quota or point deductions. We record usage to improve the service."
      ],
      [
        "Your own reading room",
        "Web and iPhone can use the same Leafhour account. Device-local books stay on your device unless you choose to upload them."
      ]
    ],
    "pricing": "See reading-points details",
    "feedbackTitle": "Tell us about\nyour reading.",
    "feedbackIntro": "Something getting in the way of reading? We would like to hear about it.",
    "emailAction": "Write us an email",
    "emailNote": "Feedback goes to our support email. No community account or public issue required.",
    "skip": "Skip to content",
    "privacyLink": "Privacy",
    "terms": "Terms",
    "appearance": "Appearance",
    "languages": "Page language",
    "home": "Back to Leafhour"
  },
  "zh-Hans": {
    "title": "加入内测",
    "description": "在 Web 先读几页，把 Leafhour 带到 iPhone。直接体验内测，也欢迎告诉我们读起来如何。",
    "heading": "下一本书，\n一起慢慢读。",
    "intro": "Leafhour 正在内测。带一本想读的书来，试试读、听和提问，也告诉我们哪些地方还不顺手。",
    "ios": "把书房带到 iPhone",
    "iosBody": "读原文，逐句听读，对照译文。遇到难句，就在原页问下去。",
    "install": "通过 TestFlight 安装",
    "unavailable": "iOS 安装入口确认中",
    "unavailableBody": "公开安装链接暂未就绪。现在可以先在 Web 试读，或通过邮件联系我们。",
    "requirement": "需要 iOS 17 或更高版本 · 内测版",
    "steps": [
      "先安装 Apple 的 TestFlight。",
      "打开 Leafhour 邀请，选择「接受」。",
      "安装 Leafhour，打开第一本书。"
    ],
    "testflight": "获取 TestFlight",
    "iosCaption": "iPhone 真实阅读界面 · 公版样书",
    "webTitle": "先读几页，再决定。",
    "webBody": "打开浏览器就能试读。在原文与译文间对照，准备好后，再把自己的书放进书房。",
    "trial": "在 Web 试读",
    "room": "打开我的书房",
    "webNote": "公版样书无需注册，可以直接开始。",
    "webCaption": "Web 真实阅读界面 · 公版样书",
    "expectTitle": "开始之前",
    "expect": [
      [
        "还在不断打磨",
        "部分交互会继续调整，也可能遇到不够顺手的地方。具体的使用反馈能帮助我们确定下一步。"
      ],
      [
        "阅读保持免费",
        "内测期间免费使用，不限制使用额度，也不扣阅读点。我们只统计用量，用于改进服务。"
      ],
      [
        "同一个私人书房",
        "Web 与 iPhone 可以使用同一 Leafhour 账号。本机书籍留在设备上，上传由你主动选择。"
      ]
    ],
    "pricing": "查看阅读点说明",
    "feedbackTitle": "读起来如何，\n想听听你的感受。",
    "feedbackIntro": "哪里读得不顺手，或有新的想法，都可以直接写信给我们。",
    "emailAction": "直接写邮件",
    "emailNote": "通过邮箱联系，无需加入社群，也不必公开提交问题。",
    "skip": "跳到正文",
    "privacyLink": "隐私说明",
    "terms": "服务条款",
    "appearance": "页面外观",
    "languages": "页面语言",
    "home": "回到 Leafhour"
  },
  "zh-Hant": {
    "title": "加入內測",
    "description": "在 Web 先讀幾頁，把 Leafhour 帶到 iPhone。直接體驗內測，也歡迎告訴我們讀起來如何。",
    "heading": "下一本書，\n一起慢慢讀。",
    "intro": "Leafhour 正在內測。帶一本想讀的書來，試試讀、聽和提問，也告訴我們哪些地方還不順手。",
    "ios": "把書房帶到 iPhone",
    "iosBody": "讀原文，逐句聽讀，對照譯文。遇到難句，就在原頁問下去。",
    "install": "透過 TestFlight 安裝",
    "unavailable": "iOS 安裝入口確認中",
    "unavailableBody": "公開安裝連結暫未就緒。現在可以先在 Web 試讀，或透過郵件聯絡我們。",
    "requirement": "需要 iOS 17 或以上版本 · 內測版",
    "steps": [
      "先安裝 Apple 的 TestFlight。",
      "打開 Leafhour 邀請，選擇「接受」。",
      "安裝 Leafhour，打開第一本書。"
    ],
    "testflight": "取得 TestFlight",
    "iosCaption": "iPhone 真實閱讀介面 · 公版範例書",
    "webTitle": "先讀幾頁，再決定。",
    "webBody": "打開瀏覽器就能試讀。在原文與譯文間對照，準備好後，再把自己的書放進書房。",
    "trial": "在 Web 試讀",
    "room": "打開我的書房",
    "webNote": "公版範例書無需註冊，可以直接開始。",
    "webCaption": "Web 真實閱讀介面 · 公版範例書",
    "expectTitle": "開始之前",
    "expect": [
      [
        "還在持續打磨",
        "部分互動會繼續調整，也可能遇到不夠順手的地方。具體的使用回饋能幫助我們決定下一步。"
      ],
      [
        "閱讀保持免費",
        "內測期間免費使用，不限制使用額度，也不扣閱讀點。我們只統計用量，用於改善服務。"
      ],
      [
        "同一個私人書房",
        "Web 與 iPhone 可以使用同一 Leafhour 帳號。本機書籍留在裝置上，上傳由你主動選擇。"
      ]
    ],
    "pricing": "查看閱讀點說明",
    "feedbackTitle": "讀起來如何，\n想聽聽你的感受。",
    "feedbackIntro": "哪裡讀得不順手，或有新的想法，都可以直接寫信給我們。",
    "emailAction": "直接寫郵件",
    "emailNote": "透過信箱聯絡，無需加入社群，也不必公開提交問題。",
    "skip": "跳到正文",
    "privacyLink": "隱私說明",
    "terms": "服務條款",
    "appearance": "頁面外觀",
    "languages": "頁面語言",
    "home": "回到 Leafhour"
  },
  "ja": {
    "title": "ベータ版に参加",
    "description": "Webですぐに試し、iPhoneでもLeafhourを。ベータ版を使って、読書の感想をお聞かせください。",
    "heading": "次の一冊を、\n一緒にゆっくり。",
    "intro": "Leafhourはベータ版を公開しています。読みたい本を一冊持って、読む・聴く・質問する体験を試してみてください。",
    "ios": "書斎をiPhoneに",
    "iosBody": "原文を読み、一文ずつ聴き、訳文と見比べる。難しい箇所は、そのページで質問できます。",
    "install": "TestFlightでインストール",
    "unavailable": "iOSのインストール先を確認中",
    "unavailableBody": "公開インストールリンクはまだ利用できません。Webで試すか、メールでお問い合わせください。",
    "requirement": "iOS 17以降 · ベータ版",
    "steps": [
      "AppleのTestFlightをインストールします。",
      "Leafhourの招待を開き、「承諾」を選びます。",
      "Leafhourをインストールして、本を開きます。"
    ],
    "testflight": "TestFlightを入手",
    "iosCaption": "実際のiPhone画面 · パブリックドメインのサンプル",
    "webTitle": "まずは数ページから。",
    "webBody": "ブラウザでサンプルを開き、原文と訳文を見比べてください。準備ができたら、自分の本を書斎へ。",
    "trial": "Webで試し読み",
    "room": "自分の書斎を開く",
    "webNote": "サンプルの試し読みには登録不要です。",
    "webCaption": "実際のWeb画面 · パブリックドメインのサンプル",
    "expectTitle": "始める前に",
    "expect": [
      [
        "改善を続けています",
        "操作が変わったり、使いづらい点が見つかったりすることがあります。具体的なご感想が改善の手がかりになります。"
      ],
      [
        "読書は無料です",
        "ベータ期間中はAI機能も無料で、利用枠による制限やポイント消費はありません。改善のために利用量のみを記録します。"
      ],
      [
        "同じ自分の書斎",
        "WebとiPhoneで同じLeafhourアカウントを使えます。端末内の本は、アップロードを選ぶまで端末に残ります。"
      ]
    ],
    "pricing": "ポイントについて",
    "feedbackTitle": "読んでみて、\nいかがでしたか。",
    "feedbackIntro": "読みにくかったところや、あったらうれしいこと。メールでお聞かせください。",
    "emailAction": "メールを書く",
    "emailNote": "メールで直接ご連絡ください。コミュニティへの参加や公開投稿は不要です。",
    "skip": "本文へスキップ",
    "privacyLink": "プライバシー",
    "terms": "利用規約",
    "appearance": "外観",
    "languages": "表示言語",
    "home": "Leafhourに戻る"
  }
};
export const betaCopy=locale=>copy[locale]||copy.en;
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function betaPage({locale='en',testflightUrl=betaChannels.testflightUrl}={}){
 if(!Object.hasOwn(slugs,locale))locale='en';
 const c=betaCopy(locale),slug=slugs[locale],canonical=`https://leafhour.com/${slug}/beta`,install=publicTestFlightUrl(testflightUrl);
 const languages=Object.entries(slugs).map(([lang,s])=>`<a href="/${s}/beta" lang="${lang}" hreflang="${lang}"${lang===locale?' aria-current="true"':''}>${languageNames[lang]}</a>`).join('');
 const notice=install?'':`<p id="beta-install-state" class="beta-note">${c.unavailableBody}</p>`;
 const schema=JSON.stringify({'@context':'https://schema.org','@type':'WebPage','@id':canonical+'#page',url:canonical,name:c.title+' · Leafhour',description:c.description,inLanguage:locale,isPartOf:{'@id':'https://leafhour.com/#website'}}).replaceAll('<','\\u003c');
 const action=install?`<a class="primary beta-install" data-beta-install href="${escape(install)}" rel="noopener noreferrer">${c.install}<span aria-hidden="true">↗</span></a>`:`<button class="primary beta-install" disabled data-beta-unavailable aria-describedby="beta-install-state">${c.unavailable}</button>`;
 return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${c.title} · Leafhour</title><meta name="description" content="${escape(c.description)}"><link rel="canonical" href="${canonical}">${Object.entries(slugs).map(([lang,s])=>`<link rel="alternate" hreflang="${lang}" href="https://leafhour.com/${s}/beta">`).join('')}<link rel="alternate" hreflang="x-default" href="https://leafhour.com/en/beta"><meta property="og:type" content="website"><meta property="og:title" content="${c.title} · Leafhour"><meta property="og:description" content="${escape(c.description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="https://leafhour.com/brand-assets/leafhour-social.png"><meta name="twitter:card" content="summary_large_image"><script type="application/ld+json">${schema}</script><link rel="icon" href="/brand-assets/leafhour-mark.svg" type="image/svg+xml"><link rel="preload" href="/fonts/newsreader/newsreader-home.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/home-public.css"><link rel="stylesheet" href="/beta.css"><script type="module" src="/home-public.mjs"></script></head>
<body class="beta-page"><a class="skip" href="#main">${c.skip}</a>${publicDocumentHeader({locale,current:'beta',search:false})}
<main id="main" tabindex="-1">
 <section class="beta-hero" aria-labelledby="beta-title"><div class="beta-intro"><p class="beta-page-label">${c.title}</p><h1 id="beta-title">${c.heading.split('\n').map(escape).join('<br>')}</h1><p class="beta-lede">${c.intro}</p>
 <div class="beta-ios" id="ios"><h2>${c.ios}</h2><p>${c.iosBody}</p><div class="beta-actions">${action}<a class="beta-secondary" href="#web">${c.trial}<span aria-hidden="true">↓</span></a></div>${notice}<p class="beta-note">${c.requirement}</p><ol class="beta-steps">${c.steps.map(step=>`<li>${escape(step)}</li>`).join('')}</ol><a class="beta-small-link" href="https://apps.apple.com/app/testflight/id899247664" rel="noopener noreferrer">${c.testflight}<span aria-hidden="true">↗</span></a></div></div>
 <figure class="beta-phone"><div class="beta-phone-paper" aria-hidden="true"></div><img src="/brand-assets/product/ios-reading.webp" width="480" height="1044" fetchpriority="high" alt="${escape(c.iosCaption)}"><figcaption>${c.iosCaption}</figcaption></figure></section>
 <section class="beta-web" id="web" aria-labelledby="beta-web-title"><figure><img src="/brand-assets/product/web-reader-640.webp" width="640" height="407" loading="lazy" alt="${escape(c.webCaption)}"><figcaption>${c.webCaption}</figcaption></figure><div><p class="beta-page-label">Web</p><h2 id="beta-web-title">${c.webTitle}</h2><p>${c.webBody}</p><div class="beta-actions"><a class="primary" href="/read?book=gutenberg-alice&amp;ui=${locale}">${c.trial}<span aria-hidden="true">↗</span></a><a class="beta-secondary" href="/library?ui=${locale}">${c.room}</a></div><p class="beta-note">${c.webNote}</p></div></section>
 <section class="beta-expect" aria-labelledby="beta-expect-title"><h2 id="beta-expect-title">${c.expectTitle}</h2><div>${c.expect.map(([title,body])=>`<article><h3>${escape(title)}</h3><p>${escape(body)}</p></article>`).join('')}<a class="beta-small-link" href="/${slug}/pricing">${c.pricing}<span aria-hidden="true">↗</span></a></div></section>
 <section class="beta-feedback" id="feedback" aria-labelledby="beta-feedback-title"><div class="beta-feedback-intro"><h2 id="beta-feedback-title">${c.feedbackTitle.split('\n').map(escape).join('<br>')}</h2><p>${c.feedbackIntro}</p></div><div class="beta-feedback-contact"><a class="beta-email" href="mailto:${betaChannels.supportEmail}?subject=Leafhour%20beta%20feedback">${betaChannels.supportEmail}<span aria-hidden="true">↗</span></a><p class="beta-note">${c.emailNote}</p></div></section>
</main><footer class="site-footer beta-footer"><div><a class="brand" href="/${slug}" aria-label="${c.home}"><span class="brand-name" lang="en">Leafhour</span></a><p>© 2026 Leafhour</p></div><div class="beta-footer-links"><a href="/${slug}/privacy">${c.privacyLink}</a><a href="/${slug}/terms">${c.terms}</a><a href="mailto:${betaChannels.supportEmail}">${c.emailAction}</a><span class="beta-theme"><span>${c.appearance}</span><button id="site-theme" class="site-theme" type="button" aria-label="${c.appearance}">◐</button></span></div><nav class="beta-languages" aria-label="${c.languages}">${languages}</nav></footer>${publicNavigationMenu({locale,languages})}</body></html>`;
}
