# iPhone Duo 阅读页交互稿源码

这是设计文档中的可交互 HTML 片段，不参与应用构建。它使用宿主提供的形态切换器和可选设计控件，正文与交互可独立检查。完整设计与平台约束见 [设计说明](../superpowers/specs/2026-10-30-iphone-duo-reader-design.md)。

示例短文为本次新写内容，译文和笔记均为设计样例；稿件不连接真实书房或模型。五个形态为展开对照、合上续读、笔记旁页、书本半折和桌面半折。

```html
<div id="leafhour-duo-design">
  <div class="viz-carousel viz-dotted-background" aria-label="Leafhour 阅读页形态" data-previous-label="上一种形态" data-next-label="下一种形态">
    <section data-variant="展开对照" aria-label="展开后的原译文对照">
      <div class="lh-stage"><div class="lh-device" data-mock="parallel" aria-label="原译文对照设计"></div></div>
    </section>
    <section data-variant="合上续读" aria-label="合上后的单页阅读" hidden>
      <div class="lh-stage"><div class="lh-device" data-mock="closed" aria-label="单页阅读设计"></div></div>
    </section>
    <section data-variant="笔记旁页" aria-label="正文旁边的笔记" hidden>
      <div class="lh-stage"><div class="lh-device" data-mock="notes" aria-label="笔记旁页设计"></div></div>
    </section>
    <section data-variant="书本半折" aria-label="书本式半折叠对照" hidden>
      <div class="lh-stage"><div class="lh-device" data-mock="book" aria-label="书本半折设计"></div></div>
    </section>
    <section data-variant="桌面半折" aria-label="半折叠时上读下写" hidden>
      <div class="lh-stage"><div class="lh-device" data-mock="seated" aria-label="桌面半折设计"></div></div>
    </section>
  </div>
  <div class="lh-preview-caption"><span>Leafhour · iPhone Duo</span><span>设计示例 · 非设备精确尺寸</span></div>
  <p class="lh-preview-status" role="status" aria-live="polite">正文在眼前，思考留在旁边。</p>
</div>
<style>
#leafhour-duo-design{color-scheme:light dark;--lh-paper:light-dark(#f7f4eb,#242820);--lh-pane:light-dark(#f0f0e5,#2c3328);--lh-ink:light-dark(#30382d,#e8eadf);--lh-muted:light-dark(#66715f,#b2bca7);--lh-leaf:light-dark(#365d45,#bad1ae);--lh-line:light-dark(#d5dccb,#48523f);--lh-wash:light-dark(#e2e8d9,#3b4832);--lh-frame:light-dark(#424b3e,#66705c);--lh-shadow:light-dark(#19281924,#00000045);--lh-ui:-apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif;--lh-book:"Songti SC","Noto Serif CJK SC","STSong",Georgia,serif;font-family:var(--lh-ui);color:var(--lh-ink)}
#leafhour-duo-design *{box-sizing:border-box}
#leafhour-duo-design [hidden]{display:none!important}
#leafhour-duo-design .lh-stage{min-height:730px;display:flex;align-items:center;justify-content:center;padding:20px 10px 30px;container-type:inline-size}
#leafhour-duo-design .lh-device{--lh-text:20px;width:100%;max-width:680px;min-width:0;border:6px solid var(--lh-frame);border-radius:32px;background:var(--lh-paper);box-shadow:0 18px 40px var(--lh-shadow);overflow:clip;transition:max-width .24s ease-out}
#leafhour-duo-design .lh-device[data-shape="closed"]{max-width:370px}
#leafhour-duo-design .lh-app{min-height:580px;display:grid;grid-template-columns:minmax(0,1fr) 46px;position:relative}
#leafhour-duo-design .lh-main{min-width:0;display:flex;flex-direction:column}
#leafhour-duo-design .lh-book-header{padding:28px 26px 18px;display:flex;align-items:flex-start;gap:12px}
#leafhour-duo-design .lh-title-group{min-width:0;flex:1}
#leafhour-duo-design .lh-brand{font:500 11px/1.6 var(--lh-ui);letter-spacing:.15em;color:var(--lh-leaf);margin:0 0 9px}
#leafhour-duo-design .lh-title{font:400 26px/1.35 var(--lh-book);letter-spacing:.01em;margin:0;color:var(--lh-ink)}
#leafhour-duo-design .lh-subtitle{font:400 12px/1.7 var(--lh-ui);color:var(--lh-muted);margin:8px 0 0}
#leafhour-duo-design button{font-family:var(--lh-ui);color:var(--lh-leaf);border:0;background:transparent;border-radius:10px;padding:8px 10px;min-height:44px;touch-action:manipulation}
#leafhour-duo-design button:hover{background:var(--lh-wash)}
#leafhour-duo-design button:active{background:var(--lh-line)}
#leafhour-duo-design .lh-book-header button{font-size:12px;white-space:nowrap;margin-top:0;padding-inline:7px}
#leafhour-duo-design .lh-body{flex:1;min-width:0;position:relative;padding:0 26px 18px;display:grid;grid-template-columns:minmax(0,1fr);gap:24px}
#leafhour-duo-design .lh-device[data-side="true"] .lh-body{grid-template-columns:minmax(0,1.04fr) minmax(0,1fr);gap:36px}
#leafhour-duo-design .lh-device[data-side="true"] .lh-reading{padding-right:0}
#leafhour-duo-design .lh-reading{min-width:0}
#leafhour-duo-design .lh-column-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px;margin-bottom:8px;border-bottom:1px solid var(--lh-line)}
#leafhour-duo-design .lh-column-label{font:400 11px/1.5 var(--lh-ui);letter-spacing:.06em;color:var(--lh-muted)}
#leafhour-duo-design .lh-column-head button{font-size:11px;padding:6px;min-height:44px}
#leafhour-duo-design .lh-translation-controls{display:flex;gap:0;flex-wrap:wrap}
#leafhour-duo-design .lh-translation-controls button[aria-pressed="true"]{color:var(--lh-ink);text-decoration:underline;text-underline-offset:6px;text-decoration-color:var(--lh-leaf)}
#leafhour-duo-design .lh-pair{min-width:0;display:grid;grid-template-columns:minmax(0,1fr);gap:0;margin:0 0 21px}
#leafhour-duo-design .lh-pair p{font:400 var(--lh-text)/1.85 var(--lh-book);letter-spacing:.015em;color:var(--lh-ink);margin:0;overflow-wrap:anywhere;user-select:text}
#leafhour-duo-design .lh-pair .lh-source{font-family:Georgia,"Times New Roman",serif;font-size:calc(var(--lh-text) - 2px);line-height:1.8;letter-spacing:0}
#leafhour-duo-design .lh-device[data-dual="true"] .lh-column-head{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:36px}
#leafhour-duo-design .lh-device[data-dual="true"] .lh-pair{grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:36px}
#leafhour-duo-design .lh-device[data-dual="false"][data-language="translation"] .lh-pair>.lh-source{display:none}
#leafhour-duo-design .lh-device[data-dual="false"][data-language="source"] .lh-pair>.lh-translation{display:none}
#leafhour-duo-design .lh-device[data-dual="false"] .lh-original-label{display:none}
#leafhour-duo-design .lh-device[data-dual="true"] .lh-current-language{display:none}
#leafhour-duo-design .lh-column-head .lh-right-head{display:flex;align-items:center;justify-content:space-between;gap:4px;flex-wrap:wrap}
#leafhour-duo-design .lh-current-language{font-size:12px!important}
#leafhour-duo-design .lh-no-translation{display:block;font:400 11px/1.7 var(--lh-ui);color:var(--lh-muted);margin:0 0 8px;letter-spacing:0}
#leafhour-duo-design .lh-fallback{font:400 calc(var(--lh-text) - 2px)/1.8 Georgia,"Times New Roman",serif}
#leafhour-duo-design .lh-pair[data-current="true"]{position:relative}
#leafhour-duo-design .lh-pair[data-current="true"]::before{content:"";position:absolute;left:-12px;top:8px;bottom:8px;width:2px;background:var(--lh-line);border-radius:2px}
#leafhour-duo-design .lh-quote-mark{background:var(--lh-wash);color:inherit;text-decoration:underline;text-decoration-color:var(--lh-line);text-underline-offset:4px;padding:1px 0}
#leafhour-duo-design .lh-aside{min-width:0;display:flex;flex-direction:column;background:var(--lh-pane);border-radius:4px 16px 16px 4px;padding:0 16px 16px;margin:0 -10px 0 0;align-self:stretch}
#leafhour-duo-design .lh-aside[hidden]{display:none}
#leafhour-duo-design .lh-tabs{display:flex;align-items:center;gap:0;border-bottom:1px solid var(--lh-line);margin-bottom:20px;min-height:44px;flex-wrap:wrap}
#leafhour-duo-design .lh-tabs button{font-size:12px;padding-inline:8px}
#leafhour-duo-design .lh-tabs button[aria-pressed="true"]{color:var(--lh-ink);font-weight:500;text-decoration:underline;text-decoration-color:var(--lh-leaf);text-underline-offset:7px}
#leafhour-duo-design .lh-tabs .lh-close{margin-left:auto;font-size:18px;min-width:36px}
#leafhour-duo-design .lh-aside-title{font:400 23px/1.5 var(--lh-book);margin:0 0 16px}
#leafhour-duo-design blockquote{margin:0 0 22px;padding:0 0 0 12px;border-left:2px solid var(--lh-line);font:400 15px/1.85 var(--lh-book);color:var(--lh-muted)}
#leafhour-duo-design .lh-note-label{font:400 11px/1.7 var(--lh-ui);color:var(--lh-muted);display:block;margin-bottom:12px}
#leafhour-duo-design textarea{display:block;width:100%;min-height:154px;resize:vertical;border:0;border-radius:0;background:transparent;color:var(--lh-ink);padding:0;font:400 17px/1.95 var(--lh-book)}
#leafhour-duo-design textarea::placeholder{color:var(--lh-muted);opacity:1}
#leafhour-duo-design .lh-note-actions{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap;font:400 11px/1.6 var(--lh-ui);color:var(--lh-muted)}
#leafhour-duo-design .lh-note-actions button{background:var(--lh-leaf);color:var(--lh-paper);padding-inline:18px;font-size:12px}
#leafhour-duo-design .lh-panel[hidden]{display:none}
#leafhour-duo-design .lh-reading-footer{padding:0 26px 18px;display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--lh-muted);font:400 11px/1.6 var(--lh-ui)}
#leafhour-duo-design .lh-reading-footer button{font-size:11px;padding-inline:0}
#leafhour-duo-design .lh-rail{min-width:0;padding:16px 0;display:flex;flex-direction:column;align-items:center;gap:4px;background:var(--lh-pane);border-left:1px solid var(--lh-line);z-index:2}
#leafhour-duo-design .lh-time{font:500 10px/1.5 var(--lh-ui);margin:0 0 14px;color:var(--lh-muted)}
#leafhour-duo-design .lh-rail button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:44px;min-height:48px;border-radius:0;font-size:10px;padding:4px 0;color:var(--lh-muted)}
#leafhour-duo-design .lh-rail button[aria-pressed="true"]{color:var(--lh-leaf);background:var(--lh-wash)}
#leafhour-duo-design .lh-rail i{display:inline-flex;min-height:18px;align-items:center;justify-content:center;font-size:18px;font-style:normal;font-family:var(--lh-book)}
#leafhour-duo-design .lh-rail svg{width:18px;height:18px}
#leafhour-duo-design .lh-rail-spacer{flex:1;min-height:24px}
#leafhour-duo-design .lh-device[data-shape="book"] .lh-body::after{content:"";position:absolute;pointer-events:none;top:0;bottom:18px;left:50%;width:20px;transform:translateX(-50%);background:linear-gradient(90deg,transparent,var(--lh-shadow),transparent);opacity:.65}
#leafhour-duo-design .lh-device[data-shape="seated"]{max-width:500px}
#leafhour-duo-design .lh-device[data-shape="seated"] .lh-app{grid-template-columns:minmax(0,1fr)}
#leafhour-duo-design .lh-device[data-shape="seated"] .lh-book-header{padding-top:22px;padding-bottom:10px}
#leafhour-duo-design .lh-device[data-shape="seated"] .lh-body{display:flex;flex-direction:column;gap:30px;padding-bottom:12px}
#leafhour-duo-design .lh-device[data-shape="seated"] .lh-pair{margin-bottom:16px}
#leafhour-duo-design .lh-device[data-shape="seated"] .lh-aside{margin:0 -12px;padding:0 18px 14px;border-radius:8px;position:relative}
#leafhour-duo-design .lh-device[data-shape="seated"] .lh-aside::before{content:"";position:absolute;left:-2px;right:-2px;top:-18px;height:1px;background:var(--lh-line);box-shadow:0 3px 7px var(--lh-shadow)}
#leafhour-duo-design .lh-device[data-shape="seated"] .lh-aside-title{display:none}
#leafhour-duo-design .lh-device[data-shape="seated"] blockquote{margin-bottom:14px;font-size:14px}
#leafhour-duo-design .lh-device[data-shape="seated"] textarea{min-height:90px;font-size:16px}
#leafhour-duo-design .lh-device[data-shape="seated"] .lh-note-label{margin-bottom:6px}
#leafhour-duo-design .lh-device[data-shape="seated"] .lh-tabs{margin-bottom:12px}
#leafhour-duo-design .lh-device[data-shape="seated"] .lh-pair[data-index="0"],#leafhour-duo-design .lh-device[data-shape="seated"] .lh-pair[data-index="2"]{display:none}
#leafhour-duo-design .lh-device[data-shape="seated"] .lh-rail{border-left:0;border-top:1px solid var(--lh-line);flex-direction:row;justify-content:space-evenly;padding:4px 10px}
#leafhour-duo-design .lh-device[data-shape="seated"] .lh-time,#leafhour-duo-design .lh-device[data-shape="seated"] .lh-rail-spacer{display:none}
#leafhour-duo-design .lh-device[data-shape="seated"] .lh-reading-footer{padding-bottom:8px}
#leafhour-duo-design .lh-device[data-compact="true"] .lh-aside{margin:6px -10px 0;padding-top:0;border-radius:16px}
#leafhour-duo-design .lh-device[data-compact="true"]:not([data-shape="seated"]) .lh-body:has(.lh-aside:not([hidden]))>.lh-reading{display:none}
#leafhour-duo-design .lh-device[data-shape="book"][data-compact="false"][data-dual="false"][data-side="false"] .lh-reading{max-width:calc(50% - 18px)}
#leafhour-duo-design .lh-device[data-shape="book"][data-compact="false"][data-dual="false"][data-side="false"][data-book-side="trailing"] .lh-reading{margin-left:calc(50% + 18px)}
#leafhour-duo-design .lh-preview-caption{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font:400 11px/1.6 var(--lh-ui);color:var(--lh-muted);padding-top:12px}
#leafhour-duo-design .lh-preview-status{font:400 12px/1.8 var(--lh-ui);color:var(--lh-muted);margin:8px 0 0;min-height:22px}
#leafhour-duo-design .lh-help{font:400 12px/1.8 var(--lh-ui);color:var(--lh-muted);margin:0 0 16px}
#leafhour-duo-design .lh-dialog{background:var(--lh-paper);color:var(--lh-ink);border:1px solid var(--lh-line);border-radius:20px;max-width:min(360px,calc(100% - 32px));padding:24px;font:400 16px/1.8 var(--lh-ui)}
#leafhour-duo-design .lh-dialog::backdrop{background:var(--lh-shadow)}
#leafhour-duo-design .lh-dialog p{margin:0 0 16px}
@media(max-width:520px){#leafhour-duo-design .lh-stage{min-height:760px;padding:14px 2px 24px}#leafhour-duo-design .lh-book-header{padding:24px 18px 14px}#leafhour-duo-design .lh-body{padding-inline:18px}#leafhour-duo-design .lh-reading-footer{padding-inline:18px}#leafhour-duo-design .lh-title{font-size:23px}#leafhour-duo-design .lh-device{border-width:5px;border-radius:27px}#leafhour-duo-design .lh-app{grid-template-columns:minmax(0,1fr) 44px}#leafhour-duo-design .lh-preview-caption{font-size:11px}#leafhour-duo-design .lh-device[data-shape="seated"] .lh-rail button{width:40px}}
@media(prefers-reduced-motion:reduce){#leafhour-duo-design .lh-device{transition:none}}
@media(prefers-contrast:more){#leafhour-duo-design{--lh-muted:light-dark(#424d3b,#d6e0ca);--lh-line:light-dark(#7b8b6d,#829170)}}
</style>
<script>
(() => {
  const root = document.getElementById('leafhour-duo-design');
  const status = root.querySelector('.lh-preview-status');
  const originals = [
    'At dusk, Mei returned to the garden. The light had left the path, but the stones still held the warmth of the day.',
    'She had come to decide what to plant next spring. Instead, she sat beside the empty bed and listened to the leaves moving above her.',
    'The garden did not ask her to finish a thought. For a while, it was enough to notice what was already growing.'
  ];
  const translations = {
    literal: ['黄昏时，梅回到花园。光已经离开小路，但石头仍留着白天的温暖。', '她来这里是为了决定明年春天种什么。她却坐在空花畦旁，听着头顶的树叶在动。', null],
    interpretive: ['暮色渐深，梅回到花园。小路已暗下来，石头还带着白日的余温。', '她本想决定来年春天种些什么，最后却在空花畦旁坐下，听头顶的叶子轻轻作响。', null]
  };
  const models = [];
  let draft = '有时，先坐下来看看，才知道下一步想做什么。';
  let noteSaved = false;
  const defaults = {
    parallel: { shape: 'expanded', readingMode: 'parallel', pane: 'none', fontSize: 20 },
    closed: { shape: 'closed', readingMode: 'single', pane: 'none', fontSize: 20 },
    notes: { shape: 'expanded', readingMode: 'single', pane: 'notes', fontSize: 20 },
    book: { shape: 'book', readingMode: 'parallel', pane: 'none', fontSize: 20 },
    seated: { shape: 'seated', readingMode: 'single', pane: 'notes', fontSize: 20 }
  };
  const validShapes = ['expanded', 'closed', 'book', 'seated'];
  const validPanes = ['none', 'translation', 'notes', 'chat'];
  const announce = message => { status.textContent = message; };
  function persist() {
    const choices = models.map(({ element, state }) => ({ view: element.dataset.mock, shape: state.shape, readingMode: state.readingMode, pane: state.pane, variant: state.variant, language: state.language, fontSize: state.fontSize, bookSide: state.bookSide }));
    if (typeof window.openai?.setWidgetState === 'function') {
      Promise.resolve(window.openai.setWidgetState({ modelContent: { readerDesign: 'Leafhour Duo', choices }, privateContent: null })).catch(() => {});
    }
  }
  function restore(snapshot) {
    const choices = snapshot?.modelContent?.choices;
    if (!Array.isArray(choices)) return;
    for (const model of models) {
      const choice = choices.find(value => value && value.view === model.element.dataset.mock);
      if (!choice) continue;
      if (validShapes.includes(choice.shape)) model.state.shape = choice.shape;
      if (validPanes.includes(choice.pane)) model.state.pane = choice.pane;
      if (['single', 'parallel'].includes(choice.readingMode)) model.state.readingMode = choice.readingMode;
      if (['leading', 'trailing'].includes(choice.bookSide)) model.state.bookSide = choice.bookSide;
      if (['literal', 'interpretive'].includes(choice.variant)) model.state.variant = choice.variant;
      if (['source', 'translation'].includes(choice.language)) model.state.language = choice.language;
      if (Number.isFinite(choice.fontSize)) model.state.fontSize = Math.max(18, Math.min(24, choice.fontSize));
      model.render();
    }
  }
  for (const element of root.querySelectorAll('[data-mock]')) {
    const key = element.dataset.mock;
    const state = { ...defaults[key], variant: 'interpretive', language: 'translation', bookSide: 'leading' };
    element.innerHTML = `
      <div class="lh-app">
        <main class="lh-main">
          <header class="lh-book-header">
            <div class="lh-title-group"><p class="lh-brand">LEAFHOUR</p><h2 class="lh-title">暮色里的花园</h2><p class="lh-subtitle">第一节 · Leafhour 示例短文</p></div>
            <button type="button" data-action="info" aria-label="查看书目信息">书目 ↗</button>
          </header>
          <div class="lh-body">
            <article class="lh-reading" aria-label="可选择复制的阅读正文">
              <div class="lh-column-head">
                <span class="lh-column-label lh-original-label">ENGLISH · 原文</span>
                <div class="lh-right-head"><button type="button" class="lh-current-language" data-action="language" aria-label="切换主要阅读语言">中文 ⇄</button><span class="lh-column-label" data-label="translation">中文译文 · 示例草稿</span><div class="lh-translation-controls" aria-label="选择译法"><button type="button" data-variant-choice="literal">直译</button><button type="button" data-variant-choice="interpretive" aria-pressed="true">意译</button></div></div>
              </div>
              ${originals.map((text, index) => `<div class="lh-pair" data-index="${index}" data-current="${index === 1}"><p class="lh-source" lang="en">${text}</p><p class="lh-translation" lang="zh-Hans"></p></div>`).join('')}
            </article>
            <aside class="lh-aside" aria-label="阅读旁页" hidden>
              <nav class="lh-tabs" aria-label="阅读辅助内容"><button type="button" data-pane-choice="translation">译文</button><button type="button" data-pane-choice="notes">笔记</button><button type="button" data-pane-choice="chat">陪读</button><button type="button" class="lh-close" data-action="close" aria-label="收起阅读旁页">×</button></nav>
              <section class="lh-panel" data-panel="notes"><h3 class="lh-aside-title">留在这一句旁边</h3><blockquote>“她却坐在空花畦旁，听着头顶的树叶在动。”</blockquote><label class="lh-note-label" for="lh-note-${key}">我的笔记 · 第 2 段 · 示例</label><textarea id="lh-note-${key}" data-note aria-label="编辑示例笔记" placeholder="把自己的想法留在这里…"></textarea><div class="lh-note-actions"><span data-note-status>草稿</span><button type="button" data-action="save">保存笔记</button></div></section>
              <section class="lh-panel" data-panel="chat" hidden><h3 class="lh-aside-title">从这一句聊起</h3><blockquote>“她却坐在空花畦旁，听着头顶的树叶在动。”</blockquote><p class="lh-help">引用保持在第 2 段，正文可以继续阅读。</p><label class="lh-note-label" for="lh-question-${key}">关于这一段的问题</label><textarea id="lh-question-${key}" data-question aria-label="输入示例问题" placeholder="这句话让你想到什么？"></textarea><div class="lh-note-actions"><span>尚未发送</span><button type="button" data-action="ask">提问</button></div></section>
              <section class="lh-panel" data-panel="translation" hidden><h3 class="lh-aside-title">这一段的译文</h3><span class="lh-note-label">第 2 段 · 意译 · 示例草稿</span><p class="lh-help" data-compact-translation></p><button type="button" data-action="close">返回正文</button></section>
            </aside>
          </div>
          <footer class="lh-reading-footer"><span data-footer>第一节 · 示例</span><button type="button" data-action="swap-side" hidden>换到另一侧</button><button type="button" data-action="locate">回到第 2 段 ↗</button></footer>
        </main>
        <nav class="lh-rail" aria-label="阅读工具"><span class="lh-time" aria-hidden="true">9:41</span><button type="button" data-action="contents" aria-label="打开目录"><i data-lucide="list" aria-hidden="true">≡</i><span>目录</span></button><button type="button" data-action="font" aria-label="调整字号"><i aria-hidden="true">Aa</i><span>字号</span></button><span class="lh-rail-spacer"></span><button type="button" data-action="parallel" aria-label="打开或收起原译文对照"><i data-lucide="languages" aria-hidden="true">文</i><span>对照</span></button><button type="button" data-pane-choice="notes" aria-label="打开或收起笔记"><i data-lucide="square-pen" aria-hidden="true">记</i><span>笔记</span></button><button type="button" data-pane-choice="chat" aria-label="打开或收起陪读"><i data-lucide="message-circle" aria-hidden="true">聊</i><span>陪读</span></button></nav>
      </div>
      <dialog class="lh-dialog"><p data-dialog-content></p><button type="button" data-action="dialog-close">继续阅读</button></dialog>`;
    const note = element.querySelector('[data-note]');
    const question = element.querySelector('[data-question]');
    const dialog = element.querySelector('dialog');
    note.value = draft;
    function render() {
      const compact = state.shape === 'closed' || element.clientWidth < 520;
      const dual = !compact && ['expanded', 'book'].includes(state.shape) && state.readingMode === 'parallel' && state.pane === 'none';
      const side = !compact && ['expanded', 'book'].includes(state.shape) && ['translation', 'notes', 'chat'].includes(state.pane);
      element.dataset.shape = state.shape;
      element.dataset.pane = state.pane;
      element.dataset.language = state.language;
      element.dataset.compact = String(compact);
      element.dataset.dual = String(dual);
      element.dataset.side = String(side);
      element.dataset.bookSide = state.bookSide;
      element.style.setProperty('--lh-text', `${state.fontSize}px`);
      const asideVisible = ['notes', 'chat'].includes(state.pane) || (state.pane === 'translation' && !dual);
      element.querySelector('.lh-aside').hidden = !asideVisible;
      for (const panel of element.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== state.pane;
      for (const button of element.querySelectorAll('[data-pane-choice]')) button.setAttribute('aria-pressed', String(button.dataset.paneChoice === state.pane));
      element.querySelector('[data-action="parallel"]').setAttribute('aria-pressed', String(state.readingMode === 'parallel'));
      element.querySelector('[data-action="swap-side"]').hidden = !(state.shape === 'book' && !compact && !dual && !side);
      for (const button of element.querySelectorAll('[data-variant-choice]')) button.setAttribute('aria-pressed', String(button.dataset.variantChoice === state.variant));
      element.querySelector('[data-action="language"]').textContent = state.language === 'source' ? '原文 ⇄' : '中文 ⇄';
      element.querySelector('[data-label="translation"]').hidden = state.language === 'source' && !dual;
      element.querySelector('.lh-translation-controls').hidden = state.language === 'source' && !dual;
      for (const paragraph of element.querySelectorAll('.lh-translation')) {
        const index = Number(paragraph.parentElement.dataset.index);
        const translated = translations[state.variant][index];
        if (translated) paragraph.textContent = translated;
        else {
          paragraph.replaceChildren();
          const label = document.createElement('span'); label.className = 'lh-no-translation'; label.textContent = '尚无译文 · 保留原文';
          const source = document.createElement('span'); source.className = 'lh-fallback'; source.lang = 'en'; source.textContent = originals[index];
          paragraph.append(label);
          if (!dual) paragraph.append(source);
        }
      }
      element.querySelector('[data-compact-translation]').textContent = translations[state.variant][1];
      element.querySelector('[data-panel="translation"] .lh-note-label').textContent = `第 2 段 · ${state.variant === 'literal' ? '直译' : '意译'} · 示例草稿`;
      element.querySelector('[data-note-status]').textContent = noteSaved ? '预览中已保存' : '草稿';
      element.querySelector('[data-footer]').textContent = state.shape === 'seated' ? '第 2 段 · 示例' : state.readingMode === 'parallel' && !dual ? (state.pane === 'none' ? '对照 · 单栏切换' : '正文 · 对照已暂收起') : '第一节 · 示例';
    }
    const model = { element, state, render };
    models.push(model);
    note.addEventListener('input', () => {
      draft = note.value; noteSaved = false;
      for (const other of models) {
        const input = other.element.querySelector('[data-note]');
        if (input !== note) input.value = draft;
        other.element.querySelector('[data-note-status]').textContent = '草稿';
      }
    });
    element.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || !element.contains(button)) return;
      if (button.dataset.paneChoice) {
        const value = button.dataset.paneChoice;
        state.pane = button.closest('.lh-rail') && state.pane === value ? 'none' : value;
        render(); persist();
        announce(state.pane === 'none' ? '旁页已收起，继续同一段阅读。' : `已打开${{ translation: '译文', notes: '笔记', chat: '陪读' }[state.pane]}，引用仍在第 2 段。`);
      } else if (button.dataset.variantChoice) {
        state.variant = button.dataset.variantChoice; render(); persist();
        announce(`正在查看${state.variant === 'literal' ? '直译' : '意译'}示例，缺译段落仍保留原文。`);
      } else {
        switch (button.dataset.action) {
          case 'parallel': state.readingMode = state.readingMode === 'parallel' ? 'single' : 'parallel'; state.pane = 'none'; render(); persist(); announce(state.readingMode === 'parallel' ? '原译文对照已打开；窄窗口中可切换原文与中文。' : '已恢复主要语言的单栏阅读。'); break;
          case 'swap-side': state.bookSide = state.bookSide === 'leading' ? 'trailing' : 'leading'; render(); persist(); announce('正文已换到折痕另一侧，阅读位置保持不变。'); break;
          case 'close': state.pane = 'none'; render(); persist(); announce('已回到正文。笔记草稿仍保留在当前预览中。'); break;
          case 'language': state.language = state.language === 'source' ? 'translation' : 'source'; render(); persist(); break;
          case 'font': state.fontSize = state.fontSize >= 23 ? 20 : 23; render(); persist(); announce(`正文字号 ${state.fontSize}，空间不足时辅助区改为紧凑呈现。`); break;
          case 'save': noteSaved = true; models.forEach(value => value.render()); announce('示例笔记已在当前预览中保留，未写入真实书房。'); break;
          case 'ask': announce(question.value.trim() ? '这是设计预览，问题没有发送，也没有调用模型。' : '可以先输入一个关于这句话的问题。'); break;
          case 'locate': {
            state.pane = 'none'; render(); persist();
            const current = element.querySelector('[data-current="true"]');
            current.animate?.([{ backgroundColor: 'var(--lh-wash)' }, { backgroundColor: 'transparent' }], { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600 });
            announce('已定位到第 2 段，笔记仍引用这一段。'); break;
          }
          case 'info': element.querySelector('[data-dialog-content]').textContent = '《暮色里的花园》为本次设计新写的虚构短文。原文、译文、笔记均为示例，未连接真实书房。'; dialog.showModal(); break;
          case 'contents': element.querySelector('[data-dialog-content]').textContent = '目录 · 第一节：暮色里的花园。当前设计只包含这一节示例。'; dialog.showModal(); break;
          case 'dialog-close': dialog.close(); break;
        }
      }
    });
    render();
    new ResizeObserver(render).observe(element);
    if (globalThis.Tweak) {
      const tweak = new Tweak({ container: element, onChange: () => { render(); persist(); } });
      tweak.addSelect(state, 'shape', { label: '设备形态', options: [{ label: '完全展开', value: 'expanded' }, { label: '合上', value: 'closed' }, { label: '书本式半折', value: 'book' }, { label: '桌面半折', value: 'seated' }] });
      tweak.addSlider(state, 'fontSize', { label: '正文字号', min: 18, max: 24, step: 1, unit: 'pt' });
    }
  }
  restore(window.openai?.widgetState);
  window.addEventListener('openai:set_globals', event => {
    if (event.detail?.globals?.widgetState) restore(event.detail.globals.widgetState);
  });
})();
</script>

```
