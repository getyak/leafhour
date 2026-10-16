// Both public homepages use home.html. These are authored presentation strings,
// never book contents, account data, HTML from an API, or model translations.
const english=new Map([
  ['Leafhour — AI 辅助的私人阅读书房','Leafhour — Your personal AI reading room'],
  ['Leafhour 是开源的 AI 辅助私人阅读书房。导入 PDF、Markdown 或文本，按段对照原文与译文，保存高亮、笔记和阅读时间，并按书授权自己的 AI Agent。','Leafhour is an open-source AI reading room for PDF, Markdown and text books, with bilingual passages, personal notes, reading time and book-scoped MCP access.'],
  ['开源的 AI 辅助私人阅读书房，支持 PDF、Markdown 与文本导入、原文与译文对照、笔记和按书授权的 MCP 接入。','An open-source AI reading room for PDF, Markdown and text, with bilingual passages, notes and book-scoped MCP access.'],
  ['跳到正文','Skip to content'],['Leafhour 首页','Leafhour home'],['主导航','Main navigation'],['>书房</a>','>Library</a>'],['阅读的方法','How to read'],['自己的书房','Your room'],
  ['留一点时间，读进一本书。','Make a little time. Settle into a book.'],['原文、译文和自己的思考，<br>各有自己的位置。','The original, the translation, your thoughts.<br>Each has a place of its own.'],
  ['公版书可直接试读。登录后保存自己的书与记录。','Read public samples freely. Sign in to save your own books and records.'],
  ['阳光穿过绿叶和窗户，落在展开的书与浅色桌面上，Leafhour 品牌插画','Sunlight through leaves and a window falls on an open book and a pale desk, a Leafhour illustration'],
  ['一页，再一页。','One page, then another.'],['让阅读回到日常。','Make room for reading every day.'],
  ['读过之后，<br>留一点自己的理解。','After reading,<br>keep a thought of your own.'],
  ['在一句话旁边停一停，用自己的话记下理解。还没想通的，就先留成问题，下一次回到原页。','Pause beside a sentence and put your understanding into words. Leave what you have not resolved as a question, ready for your next visit.'],
  ['遇见难句，可以对照原文、直译与意译。AI 译文标为草稿；没有译文的地方，原文始终保留。','Compare a difficult sentence with the original, a literal translation or an interpretation. AI translations are marked as drafts; untranslated passages keep the original.'],
  ['打开这本书','Open this book'],['《爱丽丝梦游仙境》· 阅读示例','Alice’s Adventures in Wonderland · Reading example'],['中文意译 · 页面示例','Chinese interpretation · Reading example'],['读到这里，你想起了什么？','What does this passage bring to mind?'],['打开爱丽丝梦游仙境','Open Alice’s Adventures in Wonderland'],
  ['一张轻轻翻起的书页与布面书脊，Leafhour 品牌插画','A gently turning page and a clothbound spine, a Leafhour illustration'],['让每一次回来，都有起点。','Have a place to return to.'],
  ['读过的日子，<br>会留下痕迹。','The days you read<br>leave a trace.'],
  ['今天读了哪里，写下什么，还有什么没想通，阅读日历都记下来。选择一天，就能回到那本书和那句话。','Your reading calendar keeps where you read, what you wrote and the questions still open. Choose a day to return to the book and the passage.'],
  ['今天，读几页','Read a few pages today'],['选一个适合自己的每日目标，从上次的位置继续。','Choose a daily goal that fits your life and continue where you left off.'],['读完，留一笔','Leave a thought afterward'],['记录自己的理解，或标记真正读完的章节。','Write down your understanding, or mark a chapter you have finished.'],['明天，再回来','Come back tomorrow'],['时间与记录留在日历里，接着读下去。','Your time and thoughts stay in the calendar, ready to continue.'],
  ['阅读时间只记录前台停留。读完由你标记，理解也由你判断。','Reading time counts foreground visits only. You decide when you have finished and what you have understood.'],['打开我的阅读日历','Open my reading calendar'],
  ['先挑一本，慢慢读。','Pick a book. Take your time.'],['进入书房','Enter reading room'],['正在载入书架…','Opening the bookshelf…'],
  ['默认书籍来自 Project Gutenberg，原文在美国属于公版；各书保留来源和许可说明，使用时请核对所在地规则。','The default books come from Project Gutenberg and are public domain in the United States. Source and license details are retained; check the rules where you live.'],
  ['一本书，<br>一间自己的书房。','One book.<br>A room of your own.'],['带来自己的 PDF、Markdown 或纯文本。原文和译文各自保留，你写下的笔记也有自己的位置。','Bring your own PDF, Markdown or text file. The original and translations are kept separately, with a place for your own notes.'],
  ['书籍与阅读记录按自己的账户保存。围绕原文提问时，助手的解释和自己的笔记分别保留。','Books and reading records belong to your account. When you ask about the text, the assistant’s explanation stays distinct from your notes.'],['Leafhour 以 AGPL-3.0 开源，可在本地运行或自行托管。','Leafhour is open source under AGPL-3.0 and can run locally or be self-hosted.'],['打开我的书房','Open my reading room'],
  ['开始之前，你也许想知道。','A few things before you begin.'],['Leafhour 适合怎样的阅读？','What kind of reading is Leafhour for?'],
  ['Leafhour 是开源的 AI 辅助私人阅读书房。你可以持续阅读一本书，在原句旁留下高亮、理解与问题，需要时再请求翻译或和阅读助手对话。','Leafhour is an open-source AI reading room. Spend time with a whole book, keep highlights and questions beside the source, and request translation or conversation when you need it.'],
  ['可以导入哪些格式？','What files can I import?'],['目前支持 PDF、Markdown（.md）和纯文本（.txt）。PDF 提取的文字需要与原稿核对；图片扫描件需要文字层。当前不支持 EPUB。','PDF, Markdown (.md) and plain text (.txt) are supported. Check extracted PDF text against the source; image-only scans need a text layer. EPUB is not currently supported.'],
  ['原文、译文和自己的笔记怎样区分？','How are the original, translations and notes kept apart?'],['三者分别保存和展示。AI 译文标为草稿，没有译文时保留原文。公版样书预存了开头部分的中文译文，不表示全书已经翻译。','They are saved and displayed separately. AI translations are drafts, and untranslated passages retain the original. Public samples include Chinese translations of opening passages, not every page.'],
  ['自己的 AI Agent 可以读书房吗？','Can my own AI agent read my books?'],['外部 Agent 通过 MCP 按书籍和数据类型授权。原文、笔记、阅读记录与评论写入分别控制。当前是技术接入，网页尚无完整的授权管理入口，详见 ','External agents use MCP with permission for a specific book and selected data types. Content, notes, activity and comment writing have separate scopes. The web interface does not yet provide full grant management; see the '],['。站内阅读助手使用独立的只读边界，不读取私人笔记或写入阅读进度。','. The built-in reading assistant has separate read-only boundaries and does not read private notes or write reading progress.'],
  ['书籍与记录可以带走吗？','Can I take my books and records with me?'],['服务支持整库导出和恢复，不要求订阅。当前网页尚无整库备份入口，可以使用兼容客户端或联系 ','Library export and restore do not require a subscription. Whole-library backup controls are not yet in the web interface; use a compatible client or contact '],['。未同步的记录与草稿仍留在原浏览器，处理方式见 ','. Unsynced records and drafts remain in the original browser. See the '],['隐私与数据说明','privacy and data notice (Chinese)'],
  ['使用 AI 和朋友共读有哪些限制？','What are the limits of AI and reading together?'],['直接阅读公版样书不需要调用模型。翻译与对话需要配置模型服务，自托管时由运营者承担供应商费用。赠书信可以分享所选阅读材料；在线好友的实时共读仍是后续设想。','Reading public samples needs no model request. Translation and conversation need a configured model service; self-hosters bear provider charges. Gift letters can share selected reading material. Live reading together with online presence is a future idea.'],
  ['有英文界面吗？','Is the reading room available in English?'],['中英文首页使用同一套布局和交互。书房和阅读界面目前主要为中文。','The English and Chinese homepages share the same layout and interactions. The reading room and reader interface are currently primarily in Chinese.'],
  ['今天，就从几页开始。','Begin with a few pages today.'],['一本想读的书，一点留给自己的时间。','A book you want to read. A little time to yourself.'],
  ['关于 Leafhour','About Leafhour'],['隐私说明','Privacy (Chinese)'],['本地运行 · 可自托管','Runs locally · Self-hostable'],['开始阅读','Start reading'],['先读几页','Read a few pages'],['</a>。</p>','</a>.</p>'],
  ['回到你的书房','Welcome back to your reading room'],['从上次停下的地方继续。','Continue where you left off.'],['验证你的邮箱','Verify your email'],['设置登录密码','Set your password'],['创建你的书房','Create your reading room'],['找回密码','Reset your password'],['下次，直接用密码进入。','Next time, sign in with your password.'],['输入邮件中的 6 位验证码。','Enter the six-digit code from your email.'],['验证邮箱后，设置你的登录密码。','Verify your email, then set your password.'],['验证邮箱后，重新设置密码。','Verify your email, then choose a new password.'],['不用密码，也能接着读。','Continue reading with an email code.'],
  ['邮箱或密码不正确','The email or password is incorrect'],['网络暂时无法连接，请稍后重试。','Unable to connect. Please try again shortly.'],['暂时无法完成，请稍后重试。','Unable to complete this. Please try again shortly.'],['验证码已过期，请重新发送。','This code has expired. Request another one.'],['验证码已过期','This code has expired'],['10 分钟内有效','Valid for ten minutes'],['正在发送验证码…','Sending your code…'],['正在进入…','Signing in…'],['正在发送…','Sending…'],['正在验证…','Verifying…'],['正在保存…','Saving…'],['保存并进入书房','Save and enter reading room'],['验证邮箱','Verify email'],['发送验证码','Send code'],['重新发送','Resend'],
  ['登录服务暂时不可用，可以先试读。','Sign-in is temporarily unavailable. You can still read a sample.'],['登录服务准备中，可以先试读。','Preparing sign-in. You can still read a sample.'],['登录 / 注册','Sign in / Sign up'],['我的书房','My reading room'],['新密码','New password'],['登录密码','sign-in password'],['显示新密码','Show new password'],['隐藏新密码','Hide new password'],['显示登录密码','Show sign-in password'],['隐藏登录密码','Hide sign-in password'],['显示','Show'],['隐藏','Hide'],['至少 8 个字符。','At least eight characters.'],['登录验证码','Email verification code'],['更换邮箱','Change email'],['验证码登录','Use an email code'],['返回密码登录','Use a password'],['忘记密码？','Forgot password?'],['第一次来？','First time here?'],['创建书房','Create a reading room'],['先试读几页','Read a sample first'],['关闭登录','Close sign-in'],['使用 Google 登录','Sign in with Google'],['使用 Apple 登录','Sign in with Apple'],['准备中','Not available yet'],['>或</span>','>or</span>'],['>邮箱</label>','>Email</label>'],['>密码</label>','>Password</label>'],
  ['本机使用','On this computer'],['进入本机书房','Open local reading room'],['仅在这台电脑使用，无需邮箱；与邮箱账户分开保存。','Use this computer without an email account. Local and email accounts keep separate data.'],
  ['继续阅读','Continue reading'],['阅读','Read'],['公版 · 英文原文','Public domain · English original'],['按需翻译','Translate on request'],['中文试读','Chinese sample'],['来源','Source'],['跟着白兔进入一个熟悉的陌生世界。','Follow the White Rabbit into a familiar, unfamiliar world.'],['写给自己的话，也留给每一个普通的今天。','Words written for oneself, and for an ordinary day.'],['走进树林，重新观察生活的尺度。','Step into the woods and look at the scale of everyday life.'],['Marcus Aurelius · 英译 Meric Casaubon','Marcus Aurelius · translated by Meric Casaubon'],['原文已保留。译文和思考，从这一页开始。','The original is here. Translation and your thoughts begin on this page.'],['书架暂时无法连接，请稍后重试。','Unable to open the bookshelf. Please try again shortly.'],
  ['暂停光影','Pause sunlight'],['开启光影','Enable sunlight'],['系统已减少动态效果','Reduced motion is enabled'],['>光影</span>','>Sunlight</span>'],['切换页面外观','Change appearance']
]);
const escaped=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const pattern=new RegExp([...english.keys()].sort((a,b)=>b.length-a.length).map(escaped).join('|'),'g');
export const homeLocale=doc=>doc?.documentElement?.lang?.startsWith('en')?'en':'zh-Hans';
export function homeText(value,locale){
  if(locale!=='en'||typeof value!=='string')return value;
  // One pass avoids translating generated English a second time.
  return value.replace(pattern,match=>english.get(match))
    .replace(/(\d+) 秒后重发/g,'Resend in $1s').replace(/(\d+) 秒后重试/g,'Try again in $1s').replace(/(\d+) 秒后可发送/g,'Send in $1s')
    .replace(/双译开篇 · (\d+) 段/g,'Two translations · $1 opening passages');
}
export function englishHomeDocument(source){
  return homeText(source,'en')
    .replace('<html lang="zh-Hans">','<html lang="en">')
    .replace('<link rel="canonical" href="https://leafhour.com/">','<link rel="canonical" href="https://leafhour.com/en">')
    .replace('<meta property="og:url" content="https://leafhour.com/">','<meta property="og:url" content="https://leafhour.com/en">')
    .replaceAll('class="brand" href="/"','class="brand" href="/en"')
    .replaceAll('href="/en" lang="en" hreflang="en">English','href="/" lang="zh-Hans" hreflang="zh-Hans">中文')
    .replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,(_,json)=>{
      const data=JSON.parse(json);
      for(const node of data['@graph']||[])if(node['@type']==='WebPage'){node['@id']='https://leafhour.com/en#page';node.url='https://leafhour.com/en';node.inLanguage='en';}
      return '<script type="application/ld+json">'+JSON.stringify(data)+'</script>';
    });
}
