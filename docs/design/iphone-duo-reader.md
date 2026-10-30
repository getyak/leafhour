# iPhone Duo 阅读页交互稿源码

2026-10-30 更新：正文优先。默认展开为单栏静读，阅读工具收在页角；按需打开原译对照、笔记或 AI 陪读。六个视图共用相同的新写示例短文，原文与译文分开，缺译文保持明确状态。

这是可交互的设计片段，不参与应用构建，不连接真实书房或模型。完整设计与平台约束见 [设计说明](../superpowers/specs/2026-10-30-iphone-duo-reader-design.md)。

```html
<div id="leafhour-duo-quiet">
  <div class="viz-carousel viz-dotted-background" aria-label="Leafhour 安静阅读设计" data-previous-label="上一种形态" data-next-label="下一种形态">
    <section data-variant="专注正文" aria-label="展开后的专注阅读"><div class="q-stage"><div class="q-page" data-view="quiet" aria-label="专注正文设计"></div></div></section>
    <section data-variant="原译对照" aria-label="按需打开原译文对照" hidden><div class="q-stage"><div class="q-page" data-view="parallel" aria-label="原译对照设计"></div></div></section>
    <section data-variant="手边笔记" aria-label="正文与笔记旁页" hidden><div class="q-stage"><div class="q-page" data-view="notes" aria-label="手边笔记设计"></div></div></section>
    <section data-variant="合上续读" aria-label="合上后的单页阅读" hidden><div class="q-stage"><div class="q-page" data-view="closed" aria-label="合上续读设计"></div></div></section>
    <section data-variant="书本半折" aria-label="书本式半折叠阅读" hidden><div class="q-stage"><div class="q-page" data-view="book" aria-label="书本半折设计"></div></div></section>
    <section data-variant="桌面半折" aria-label="半折叠时上读下写" hidden><div class="q-stage"><div class="q-page" data-view="seated" aria-label="桌面半折设计"></div></div></section>
  </div>
  <div class="q-caption"><span>Leafhour · 阅读页设计</span><span>示例内容与形态示意</span></div>
  <p class="q-feedback" role="status" aria-live="polite"></p>
</div>
<style>
#leafhour-duo-quiet{color-scheme:light dark;--q-paper:light-dark(#faf8f2,#22251f);--q-ink:light-dark(#32362e,#e2e5da);--q-muted:light-dark(#68715e,#adb6a1);--q-line:light-dark(#dfe3d8,#414a38);--q-green:light-dark(#3d6048,#bed3af);--q-wash:light-dark(#edf0e6,#323c2b);--q-panel:light-dark(#fdfcf8,#2b3026);--q-shadow:light-dark(#34442b16,#00000030);--q-book:"Songti SC","Noto Serif CJK SC","STSong",serif;--q-ui:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:var(--q-ink);font-family:var(--q-ui)}
#leafhour-duo-quiet *{box-sizing:border-box}
#leafhour-duo-quiet [hidden]{display:none!important}
#leafhour-duo-quiet .q-stage{min-height:800px;padding:28px 8px 36px;display:flex;align-items:center;justify-content:center}
#leafhour-duo-quiet .q-page{--q-size:21px;--q-leading:1.95;width:100%;max-width:690px;min-width:0;background:var(--q-paper);border:1px solid var(--q-line);border-radius:22px;position:relative;box-shadow:0 10px 32px var(--q-shadow);overflow:clip}
#leafhour-duo-quiet .q-page[data-shape="closed"]{max-width:372px}
#leafhour-duo-quiet .q-shell{min-height:620px;display:flex;flex-direction:column;position:relative}
#leafhour-duo-quiet .q-layout{flex:1;display:grid;grid-template-columns:minmax(0,1fr);padding:52px 48px 20px;gap:38px;min-width:0;position:relative}
#leafhour-duo-quiet .q-reading{width:100%;max-width:420px;margin:0 auto;min-width:0}
#leafhour-duo-quiet .q-heading{margin:0 0 34px}
#leafhour-duo-quiet .q-heading h2{font:400 28px/1.5 var(--q-book);letter-spacing:.035em;margin:0 0 7px;color:var(--q-ink)}
#leafhour-duo-quiet .q-heading p{font:400 11px/1.8 var(--q-ui);letter-spacing:.04em;color:var(--q-muted);margin:0}
#leafhour-duo-quiet .q-pair{margin-bottom:1.1em;min-width:0}
#leafhour-duo-quiet .q-pair p{font:400 var(--q-size)/var(--q-leading) var(--q-book);margin:0;color:var(--q-ink);letter-spacing:.025em;overflow-wrap:break-word;user-select:text}
#leafhour-duo-quiet .q-pair+.q-pair p:not([lang="en"]){text-indent:2em}
#leafhour-duo-quiet .q-pair .q-source,#leafhour-duo-quiet .q-fallback{font-family:Georgia,"Times New Roman",serif;letter-spacing:0;font-size:calc(var(--q-size) - 1px);line-height:1.8;text-indent:0}
#leafhour-duo-quiet .q-page:not([data-dual="true"])[data-language="translation"] .q-source{display:none}
#leafhour-duo-quiet .q-page:not([data-dual="true"])[data-language="source"] .q-translation{display:none}
#leafhour-duo-quiet .q-missing{display:block;font:400 11px/1.6 var(--q-ui);color:var(--q-muted);letter-spacing:0;text-indent:0;margin:0 0 9px}
#leafhour-duo-quiet .q-fallback{display:block;text-indent:0}
#leafhour-duo-quiet .q-column-labels{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:44px;font:400 11px/1.7 var(--q-ui);color:var(--q-muted);margin-bottom:20px}
#leafhour-duo-quiet .q-page[data-dual="true"] .q-reading{max-width:none}
#leafhour-duo-quiet .q-page[data-dual="true"] .q-pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:44px;margin-bottom:26px}
#leafhour-duo-quiet .q-page[data-dual="true"] .q-pair p{font-size:var(--q-size);line-height:1.9;letter-spacing:.015em;text-indent:0}
#leafhour-duo-quiet .q-page[data-dual="true"] .q-pair .q-source{font-size:calc(var(--q-size) - 1px);line-height:1.8;letter-spacing:0}
#leafhour-duo-quiet .q-page[data-side="true"] .q-layout{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);padding-inline:34px;gap:44px}
#leafhour-duo-quiet .q-page[data-side="true"] .q-pair p{font-size:var(--q-size)}
#leafhour-duo-quiet button{font-family:var(--q-ui);font-size:12px;font-weight:400;color:var(--q-green);background:transparent;border:0;min-height:44px;min-width:44px;border-radius:8px;padding:8px 10px;touch-action:manipulation}
#leafhour-duo-quiet button:hover{background:var(--q-wash)}
#leafhour-duo-quiet button:active{background:var(--q-line)}
#leafhour-duo-quiet select{font:400 13px/1.5 var(--q-ui);color:var(--q-ink);background:var(--q-panel);border:1px solid var(--q-line);border-radius:8px;min-height:44px;max-width:100%;padding:8px}
#leafhour-duo-quiet button:focus-visible,#leafhour-duo-quiet select:focus-visible,#leafhour-duo-quiet textarea:focus-visible{outline:2px solid var(--q-green);outline-offset:3px}
#leafhour-duo-quiet .q-footer{display:flex;align-items:center;gap:8px;min-height:70px;padding:0 24px 14px;position:relative}
#leafhour-duo-quiet .q-footer-space{flex:1}
#leafhour-duo-quiet .q-tools-toggle{font-size:24px;line-height:1;letter-spacing:.04em;color:var(--q-muted);min-width:48px;border-radius:24px}
#leafhour-duo-quiet .q-return{font-size:11px;color:var(--q-muted)}
#leafhour-duo-quiet .q-toolbar{position:absolute;right:18px;bottom:70px;z-index:4;width:min(292px,calc(100% - 36px));padding:14px 16px 12px;background:var(--q-panel);border:1px solid var(--q-line);border-radius:18px;box-shadow:0 8px 28px var(--q-shadow);color:var(--q-ink)}
#leafhour-duo-quiet .q-toolbar-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font:500 14px/1.6 var(--q-ui)}
#leafhour-duo-quiet .q-toolbar-head button{font-size:20px}
#leafhour-duo-quiet .q-setting{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0 4px;font:400 12px/1.6 var(--q-ui);color:var(--q-muted)}
#leafhour-duo-quiet .q-menu-actions{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:12px 0 8px}
#leafhour-duo-quiet .q-menu-actions button{text-align:left;color:var(--q-ink);font-size:13px;padding:10px}
#leafhour-duo-quiet .q-menu-actions button[aria-pressed="true"]{background:var(--q-wash);color:var(--q-green)}
#leafhour-duo-quiet .q-size-row{display:flex;align-items:center;gap:4px}
#leafhour-duo-quiet .q-size-row output{min-width:24px;text-align:center;font:400 12px/1.5 var(--q-ui);color:var(--q-ink)}
#leafhour-duo-quiet .q-version{border-top:1px solid var(--q-line);margin-top:8px;padding-top:7px;display:flex;justify-content:space-between;align-items:center;gap:8px;color:var(--q-muted);font:400 11px/1.6 var(--q-ui)}
#leafhour-duo-quiet .q-version button{font-size:11px;padding-inline:5px}
#leafhour-duo-quiet .q-aside{min-width:0;padding-left:0;align-self:start}
#leafhour-duo-quiet .q-aside-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px;margin-bottom:22px}
#leafhour-duo-quiet .q-aside-head h3{font:400 16px/1.6 var(--q-ui);margin:0;color:var(--q-ink)}
#leafhour-duo-quiet .q-aside-head button{font-size:19px;color:var(--q-muted)}
#leafhour-duo-quiet .q-excerpt{margin:0 0 25px;padding:0;font:400 14px/1.8 Georgia,serif;color:var(--q-muted);overflow-wrap:break-word}
#leafhour-duo-quiet .q-reference{font:400 11px/1.7 var(--q-ui);display:block;color:var(--q-muted);margin-bottom:9px}
#leafhour-duo-quiet textarea{width:100%;min-height:170px;resize:vertical;display:block;padding:0;background:transparent;color:var(--q-ink);border:0;border-radius:0;font:400 18px/1.95 var(--q-book);letter-spacing:.02em}
#leafhour-duo-quiet textarea::placeholder{color:var(--q-muted);opacity:1}
#leafhour-duo-quiet .q-note-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:15px;color:var(--q-muted);font:400 11px/1.7 var(--q-ui)}
#leafhour-duo-quiet .q-note-actions button{font-size:12px}
#leafhour-duo-quiet .q-panel-translation{font:400 19px/1.95 var(--q-book);margin:0;color:var(--q-ink)}
#leafhour-duo-quiet .q-dialog{padding:26px;background:var(--q-panel);color:var(--q-ink);border:1px solid var(--q-line);border-radius:20px;width:340px;max-width:calc(100% - 32px);font:400 14px/1.9 var(--q-ui);box-shadow:0 8px 28px var(--q-shadow)}
#leafhour-duo-quiet .q-dialog::backdrop{background:light-dark(#20271926,#00000065)}
#leafhour-duo-quiet .q-dialog p{margin:0 0 18px;white-space:pre-line}
#leafhour-duo-quiet .q-caption{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding-top:12px;font:400 11px/1.6 var(--q-ui);color:var(--q-muted)}
#leafhour-duo-quiet .q-feedback{font:400 12px/1.7 var(--q-ui);color:var(--q-muted);margin:6px 0 0;min-height:21px}
#leafhour-duo-quiet .q-page[data-fold="true"] .q-layout::after{content:"";position:absolute;pointer-events:none;top:30px;bottom:12px;left:50%;width:16px;transform:translateX(-50%);background:linear-gradient(90deg,transparent,var(--q-shadow),transparent)}
#leafhour-duo-quiet .q-page[data-fold="true"] .q-toolbar{width:min(292px,calc(50% - 28px))}
#leafhour-duo-quiet .q-page[data-fold="true"][data-dual="false"][data-side="false"] .q-reading,#leafhour-duo-quiet .q-page[data-fold="true"][data-side="false"] .q-aside{max-width:calc(50% - 22px);margin-left:0;margin-right:auto}
#leafhour-duo-quiet .q-page[data-fold="true"][data-dual="false"][data-side="false"][data-book-side="trailing"] .q-reading,#leafhour-duo-quiet .q-page[data-fold="true"][data-side="false"][data-book-side="trailing"] .q-aside{margin-left:auto;margin-right:0}
#leafhour-duo-quiet .q-page[data-shape="seated"]{max-width:480px}
#leafhour-duo-quiet .q-page[data-shape="seated"] .q-shell{min-height:650px}
#leafhour-duo-quiet .q-page[data-shape="seated"] .q-layout{display:flex;flex-direction:column;padding:34px 32px 10px;gap:34px}
#leafhour-duo-quiet .q-page[data-shape="seated"] .q-heading{margin-bottom:22px}
#leafhour-duo-quiet .q-page[data-shape="seated"] .q-pair:not([data-index="1"]){display:none}
#leafhour-duo-quiet .q-page[data-shape="seated"] .q-aside{border-top:1px solid var(--q-line);padding-top:17px;width:100%}
#leafhour-duo-quiet .q-page[data-shape="seated"] .q-aside-head{margin-bottom:12px}
#leafhour-duo-quiet .q-page[data-shape="seated"] .q-excerpt{margin-bottom:14px}
#leafhour-duo-quiet .q-page[data-shape="seated"] textarea{min-height:100px;font-size:17px}
#leafhour-duo-quiet .q-page[data-compact="true"]:not([data-shape="seated"]) .q-layout{padding:38px 25px 16px}
#leafhour-duo-quiet .q-page[data-compact="true"]:not([data-shape="seated"])[data-pane]:not([data-pane="none"]) .q-reading{display:none}
#leafhour-duo-quiet .q-page[data-compact="true"]:not([data-shape="seated"]) .q-aside{padding-top:0}
#leafhour-duo-quiet .q-page[data-compact="true"] .q-heading h2{font-size:26px}
#leafhour-duo-quiet .q-page[data-compact="true"] .q-pair p{font-size:var(--q-size)}
@media(max-width:520px){#leafhour-duo-quiet .q-stage{min-height:800px;padding:14px 1px 26px}#leafhour-duo-quiet .q-page{border-radius:18px}#leafhour-duo-quiet .q-layout{padding:38px 25px 16px}#leafhour-duo-quiet .q-footer{padding-inline:15px}#leafhour-duo-quiet .q-toolbar{right:12px;width:min(292px,calc(100% - 24px))}}
@media(prefers-reduced-motion:reduce){#leafhour-duo-quiet *{scroll-behavior:auto!important}}
@media(prefers-contrast:more){#leafhour-duo-quiet{--q-muted:light-dark(#495340,#ccd6bf);--q-line:light-dark(#879379,#7b896d)}}
</style>
<script>
(() => {
  const root = document.getElementById('leafhour-duo-quiet');
  const feedback = root.querySelector('.q-feedback');
  const revision = 'quiet-v2';
  const originals = [
    'At dusk, Mei returned to the garden. The light had left the path, but the stones still held the warmth of the day.',
    'She had come to decide what to plant next spring. Instead, she sat beside the empty bed and listened to the leaves moving above her.',
    'The garden did not ask her to finish a thought. For a while, it was enough to notice what was already growing.'
  ];
  const translations = {
    literal: ['黄昏时，梅回到花园。光已经离开小路，但石头仍留着白天的温暖。', '她来这里是为了决定明年春天种什么。她却坐在空花畦旁，听着头顶的树叶在动。', null],
    interpretive: ['暮色渐深，梅回到花园。小路已暗下来，石头还带着白日的余温。', '她本想决定来年春天种些什么，最后却在空花畦旁坐下，听头顶的叶子轻轻作响。', null]
  };
  const defaults = {
    quiet: {shape:'expanded',readingMode:'single',pane:'none'},
    parallel: {shape:'expanded',readingMode:'parallel',pane:'none'},
    notes: {shape:'expanded',readingMode:'single',pane:'notes'},
    closed: {shape:'closed',readingMode:'single',pane:'none'},
    book: {shape:'book',readingMode:'parallel',pane:'none'},
    seated: {shape:'seated',readingMode:'single',pane:'notes'}
  };
  const models = [];
  let draft = '有时，先坐下来看看，才知道下一步想做什么。';
  let noteSaved = false;
  const say = message => { feedback.textContent = message; };
  function persist() {
    if (typeof window.openai?.setWidgetState !== 'function') return;
    const choices = models.map(({element,state}) => ({view:element.dataset.view,shape:state.shape,readingMode:state.readingMode,pane:state.pane,variant:state.variant,language:state.language,fontSize:state.fontSize,bookSide:state.bookSide}));
    Promise.resolve(window.openai.setWidgetState({modelContent:{readerDesign:'Leafhour Duo',revision,choices},privateContent:null})).catch(()=>{});
  }
  function restore(snapshot) {
    if(snapshot?.modelContent?.revision!==revision || !Array.isArray(snapshot.modelContent.choices))return;
    for(const model of models){
      const value=snapshot.modelContent.choices.find(item=>item?.view===model.element.dataset.view);
      if(!value)continue;
      for(const [key,allowed] of Object.entries({shape:['expanded','closed','book','seated'],readingMode:['single','parallel'],pane:['none','translation','notes','chat'],variant:['literal','interpretive'],language:['source','translation'],bookSide:['leading','trailing']}))if(allowed.includes(value[key]))model.state[key]=value[key];
      if(Number.isFinite(value.fontSize))model.state.fontSize=Math.max(18,Math.min(25,value.fontSize));
      model.render();
    }
  }
  for(const element of root.querySelectorAll('[data-view]')){
    const key=element.dataset.view;
    const state={...defaults[key],variant:'interpretive',language:'translation',fontSize:21,bookSide:'leading',menuOpen:false};
    const menuID=`q-menu-${key}`;
    element.innerHTML=`<div class="q-shell">
      <div class="q-layout">
        <article class="q-reading" aria-label="阅读正文">
          <header class="q-heading"><h2>暮色里的花园</h2><p>第一节</p></header>
          <div class="q-column-labels" hidden><span>原文</span><span data-translation-label>意译 · 示例草稿</span></div>
          ${originals.map((text,index)=>`<div class="q-pair" data-index="${index}"><p class="q-source" lang="en">${text}</p><p class="q-translation" lang="zh-Hans"></p></div>`).join('')}
        </article>
        <aside class="q-aside" aria-label="阅读旁页" hidden>
          <div class="q-aside-head"><h3 data-pane-title>我的笔记</h3><button type="button" data-action="close-pane" aria-label="收起旁页">×</button></div>
          <span class="q-reference">原文摘录 · 第 2 段</span>
          <blockquote class="q-excerpt" lang="en">Instead, she sat beside the empty bed and listened to the leaves moving above her.</blockquote>
          <section data-panel="notes"><label class="q-reference" for="q-note-${key}">我的想法</label><textarea id="q-note-${key}" aria-label="编辑示例笔记" data-note></textarea><div class="q-note-actions"><span data-note-status>草稿</span><button type="button" data-action="save">保存笔记</button></div></section>
          <section data-panel="chat" hidden><label class="q-reference" for="q-chat-${key}">向 AI 陪读提问</label><textarea id="q-chat-${key}" aria-label="输入示例问题" data-question placeholder="关于这一句，你想问什么？"></textarea><div class="q-note-actions"><span>尚未发送</span><button type="button" data-action="ask">提问</button></div></section>
          <section data-panel="translation" hidden><span class="q-reference" data-tool-label>意译 · 示例草稿</span><p class="q-panel-translation" data-tool-translation></p></section>
        </aside>
      </div>
      <footer class="q-footer"><button type="button" class="q-return" data-action="swap-side" hidden>换侧</button><span class="q-footer-space"></span><button type="button" class="q-tools-toggle" data-action="toggle-menu" aria-label="阅读工具" aria-controls="${menuID}" aria-expanded="false">···</button></footer>
      <nav class="q-toolbar" id="${menuID}" aria-label="阅读工具菜单" hidden>
        <div class="q-toolbar-head"><span>阅读工具</span><button type="button" data-action="close-menu" aria-label="收起工具">×</button></div>
        <label class="q-setting">正文<select data-reading-language aria-label="正文语言与译法"><option value="source">原文</option><option value="literal">中文直译</option><option value="interpretive" selected>中文意译</option></select></label>
        <div class="q-setting"><span>字号</span><div class="q-size-row"><button type="button" data-action="smaller" aria-label="减小字号">A−</button><output data-font-size>21</output><button type="button" data-action="larger" aria-label="增大字号">A＋</button></div></div>
        <div class="q-menu-actions"><button type="button" data-action="parallel" aria-pressed="false">原译对照</button><button type="button" data-pane="translation">这一段译文</button><button type="button" data-pane="notes">我的笔记</button><button type="button" data-pane="chat">AI 陪读</button><button type="button" data-action="contents">目录</button><button type="button" data-action="reading">继续阅读</button></div>
        <div class="q-version"><span data-version-label>意译 · 示例草稿</span><button type="button" data-action="info">书目与版本</button></div>
      </nav>
      <dialog class="q-dialog"><p data-dialog-content></p><button type="button" data-action="close-dialog">继续阅读</button></dialog>
    </div>`;
    for(const button of element.querySelectorAll('button'))button.classList.add('cursor-interaction');
    const toggle=element.querySelector('[data-action="toggle-menu"]');
    const menu=element.querySelector('.q-toolbar');
    const note=element.querySelector('[data-note]');
    const dialog=element.querySelector('dialog');
    note.value=draft;
    function render(){
      element.dataset.shape=state.shape;
      const compact=state.shape==='closed'||element.clientWidth<550||state.fontSize>=24;
      const fold=state.shape==='book'&&element.clientWidth>=550;
      const dual=!compact&&['expanded','book'].includes(state.shape)&&state.readingMode==='parallel'&&state.pane==='none';
      const side=!compact&&['expanded','book'].includes(state.shape)&&state.pane!=='none';
      Object.assign(element.dataset,{compact:String(compact),fold:String(fold),dual:String(dual),side:String(side),pane:state.pane,language:state.language,bookSide:state.bookSide});
      element.style.setProperty('--q-size',`${state.fontSize}px`);
      element.querySelector('.q-column-labels').hidden=!dual;
      const variantLabel=state.variant==='literal'?'直译':'意译';
      element.querySelector('.q-heading p').textContent=dual||state.language==='source'?'第一节':`第一节　中文${variantLabel}草稿`;
      element.querySelector('[data-translation-label]').textContent=`${variantLabel} · 示例草稿`;
      element.querySelector('[data-version-label]').textContent=state.language==='source'?'原文 · 设计样例':`${variantLabel} · 示例草稿`;
      element.querySelector('[data-tool-label]').textContent=`${variantLabel} · 示例草稿`;
      element.querySelector('[data-reading-language]').value=state.language==='source'?'source':state.variant;
      for(const paragraph of element.querySelectorAll('.q-translation')){
        const index=Number(paragraph.parentElement.dataset.index),text=translations[state.variant][index];
        const renderKey=`${state.variant}:${index}:${dual}`;
        if(paragraph.dataset.renderKey===renderKey)continue;
        paragraph.dataset.renderKey=renderKey;
        if(text)paragraph.textContent=text;
        else{
          paragraph.replaceChildren();
          const label=document.createElement('span');label.className='q-missing';label.textContent=dual?'尚无译文':'尚无译文，以下保留原文';paragraph.append(label);
          if(!dual){const source=document.createElement('span');source.className='q-fallback';source.lang='en';source.textContent=originals[index];paragraph.append(source);}
        }
      }
      element.querySelector('.q-aside').hidden=state.pane==='none';
      for(const panel of element.querySelectorAll('[data-panel]'))panel.hidden=panel.dataset.panel!==state.pane;
      element.querySelector('[data-pane-title]').textContent={notes:'我的笔记',chat:'AI 陪读',translation:'这一段译文'}[state.pane]||'我的笔记';
      element.querySelector('[data-tool-translation]').textContent=translations[state.variant][1];
      element.querySelector('[data-note-status]').textContent=noteSaved?'预览中已保存':'草稿';
      element.querySelector('[data-action="parallel"]').setAttribute('aria-pressed',String(state.readingMode==='parallel'));
      for(const button of element.querySelectorAll('[data-pane]'))button.setAttribute('aria-pressed',String(button.dataset.pane===state.pane));
      element.querySelector('[data-font-size]').textContent=String(state.fontSize);
      element.querySelector('[data-action="smaller"]').disabled=state.fontSize<=18;
      element.querySelector('[data-action="larger"]').disabled=state.fontSize>=25;
      element.querySelector('[data-action="swap-side"]').hidden=!(fold&&!dual&&!side);
      menu.hidden=!state.menuOpen;toggle.setAttribute('aria-expanded',String(state.menuOpen));
    }
    function closeMenu(focus=true){state.menuOpen=false;render();if(focus)toggle.focus({preventScroll:true});}
    function openMenu(){state.menuOpen=true;render();menu.querySelector('button').focus({preventScroll:true});}
    function changePane(pane){state.pane=pane;closeMenu(false);persist();element.querySelector('[data-action="close-pane"]').focus({preventScroll:true});say(`已打开${{notes:'笔记',chat:'AI 陪读',translation:'这一段译文'}[pane]}，引用固定在第 2 段。`);}
    const model={element,state,render};models.push(model);
    note.addEventListener('input',()=>{draft=note.value;noteSaved=false;for(const other of models){const input=other.element.querySelector('[data-note]');if(input!==note)input.value=draft;other.element.querySelector('[data-note-status]').textContent='草稿';}});
    element.querySelector('[data-reading-language]').addEventListener('change',event=>{const value=event.target.value;state.language=value==='source'?'source':'translation';if(value!=='source')state.variant=value;render();persist();say('已切换正文显示，内容版本保留在阅读工具中。');});
    element.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.menuOpen){event.preventDefault();closeMenu();}});
    element.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button||!element.contains(button))return;
      if(button.dataset.pane){changePane(button.dataset.pane);return;}
      switch(button.dataset.action){
        case 'toggle-menu': state.menuOpen?closeMenu():openMenu();break;
        case 'close-menu':closeMenu();break;
        case 'reading':closeMenu();break;
        case 'parallel':state.readingMode=state.readingMode==='single'?'parallel':'single';state.pane='none';closeMenu();persist();say(state.readingMode==='parallel'?'已打开原译对照；窄窗口通过正文语言切换核对同一段。':'已回到主要语言的单栏阅读。');break;
        case 'close-pane':state.pane='none';render();toggle.focus({preventScroll:true});persist();say('旁页已收起，草稿仍保留。');break;
        case 'swap-side':state.bookSide=state.bookSide==='leading'?'trailing':'leading';render();persist();break;
        case 'smaller':case 'larger':state.fontSize=Math.max(18,Math.min(25,state.fontSize+(button.dataset.action==='larger'?1:-1)));render();persist();break;
        case 'save':noteSaved=true;models.forEach(value=>value.render());say('示例笔记仅保留在当前预览中。');break;
        case 'ask':say(element.querySelector('[data-question]').value.trim()?'设计预览没有发送问题或调用模型。':'请先输入关于这一句的问题。');break;
        case 'info':closeMenu(false);element.querySelector('[data-dialog-content]').textContent='暮色里的花园\n\n本次设计新写的虚构短文。原文、两种示例译文与笔记分别保存；译文为示例草稿，第 3 段尚无译文。\n\n本预览没有连接真实书房。';dialog.showModal();break;
        case 'contents':closeMenu(false);element.querySelector('[data-dialog-content]').textContent='目录\n\n第一节　暮色里的花园\n\n当前只展示这一节样例。';dialog.showModal();break;
        case 'close-dialog':dialog.close();toggle.focus({preventScroll:true});break;
      }
    });
    root.addEventListener('pointerdown',event=>{if(state.menuOpen&&!menu.contains(event.target)&&!toggle.contains(event.target))closeMenu(false);});
    render();new ResizeObserver(render).observe(element);
    if(globalThis.Tweak){
      const tweak=new Tweak({container:element,onChange:()=>{render();persist();}});
      tweak.addSelect(state,'shape',{label:'设备形态',options:[{label:'展开',value:'expanded'},{label:'合上',value:'closed'},{label:'书本半折',value:'book'},{label:'桌面半折',value:'seated'}]});
      tweak.addSlider(state,'fontSize',{label:'正文字号',min:18,max:25,step:1,unit:'pt'});
    }
  }
  restore(window.openai?.widgetState);
  window.addEventListener('openai:set_globals',event=>{if(event.detail?.globals?.widgetState)restore(event.detail.globals.widgetState);});
})();
</script>

```
