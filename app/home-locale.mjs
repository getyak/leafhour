import {publicNavigation} from './public-navigation.mjs';
import {withUiParam} from './ui-locale-codec.mjs';
// Both public homepages use home.html. These are authored presentation strings,
// never book contents, account data, HTML from an API, or model translations.
// The authored source language is Simplified Chinese; every row below carries the
// other public languages next to it, so one source document serves all locales:
// [source, English, Traditional Chinese, Japanese].
const strings=[
  // Document metadata and navigation
  ['Leafhour — AI 辅助的私人阅读书房','Leafhour — Your personal AI reading room','Leafhour — AI 輔助的私人閱讀書房','Leafhour — AI と読む、自分だけの読書室'],
  ['Leafhour 是开源的 AI 辅助私人阅读书房。导入 PDF、Markdown 或文本，按段对照原文与译文，保存高亮、笔记和阅读时间，并按书授权自己的 AI Agent。','Leafhour is an open-source AI reading room for PDF, Markdown and text books, with bilingual passages, personal notes, reading time and book-scoped MCP access.','Leafhour 是開源的 AI 輔助私人閱讀書房。匯入 PDF、Markdown 或文字檔，按段對照原文與譯文，保存高亮、筆記和閱讀時間，並按書授權自己的 AI Agent。','Leafhour はオープンソースの AI 読書室です。PDF・Markdown・テキストを取り込み、原文と訳文を段落ごとに見比べ、ハイライト・メモ・読書時間を保存し、本ごとに自分の AI Agent へ権限を渡せます。'],
  ['开源的 AI 辅助私人阅读书房，支持 PDF、Markdown 与文本导入、原文与译文对照、笔记和按书授权的 MCP 接入。','An open-source AI reading room for PDF, Markdown and text, with bilingual passages, notes and book-scoped MCP access.','開源的 AI 輔助私人閱讀書房，支援 PDF、Markdown 與文字匯入、原文與譯文對照、筆記和按書授權的 MCP 接入。','PDF・Markdown・テキストを取り込めるオープンソースの AI 読書室。原文と訳文の対照、メモ、本ごとの MCP 接続に対応します。'],
  ['跳到正文','Skip to content','跳到主要內容','本文へスキップ'],
  ['Leafhour 首页','Leafhour home','Leafhour 首頁','Leafhour ホーム'],
  ['主导航','Main navigation','主導覽','メインナビゲーション'],
  ['>书房</a>','>Library</a>','>書房</a>','>書斎</a>'],
  ['阅读的方法','How to read','閱讀的方法','読み方'],
  ['自己的书房','Your room','自己的書房','自分の書斎'],
  ['切换界面语言','Language','語言','表示言語'],
  ['打开导航菜单','Open navigation menu','開啟導覽選單','ナビゲーションメニューを開く'],
  ['关闭菜单','Close menu','關閉選單','メニューを閉じる'],
  // Hero and reading promise
  ['留一点时间，读进一本书。','Make a little time. Settle into a book.','留一點時間，讀進一本書。','少しの時間をとって、一冊の本に向き合う。'],
  ['原文、译文和自己的思考，<br>各有自己的位置。','The original, the translation, your thoughts.<br>Each has a place of its own.','原文、譯文和自己的思考，<br>各有自己的位置。','原文、訳文、そして自分の考え。<br>それぞれの居場所があります。'],
  ['公版书可直接试读。登录后保存自己的书与记录。','Read public samples freely. Sign in to save your own books and records.','公版書可直接試讀。登入後保存自己的書與記錄。','公開サンプルはそのまま読めます。ログインすると自分の本と記録を保存できます。'],
  ['阳光穿过绿叶和窗户，落在展开的书与浅色桌面上，Leafhour 品牌插画','Sunlight through leaves and a window falls on an open book and a pale desk, a Leafhour illustration','陽光穿過綠葉和窗戶，落在展開的書與淺色桌面上，Leafhour 品牌插畫','緑の葉と窓から差す光が、開いた本と淡い机に落ちる Leafhour のブランドイラスト'],
  ['一页，再一页。','One page, then another.','一頁，再一頁。','一頁、また一頁。'],
  ['让阅读回到日常。','Make room for reading every day.','讓閱讀回到日常。','読書を日常の習慣に。'],
  // Reading demo
  ['读过之后，<br>留一点自己的理解。','After reading,<br>keep a thought of your own.','讀過之後，<br>留一點自己的理解。','読み終えたら、<br>自分の理解をひとつ残す。'],
  ['在一句话旁边停一停，用自己的话记下理解。还没想通的，就先留成问题，下一次回到原页。','Pause beside a sentence and put your understanding into words. Leave what you have not resolved as a question, ready for your next visit.','在一句話旁邊停一停，用自己的話記下理解。還沒想通的，就先留成問題，下一次回到原頁。','ひとつの文のそばで立ち止まり、理解したことを自分の言葉で書き留めます。まだ腑に落ちないことは、質問として残し、次にその頁へ戻れます。'],
  ['遇见难句，可以对照原文、直译与意译。AI 译文标为草稿；没有译文的地方，原文始终保留。','Compare a difficult sentence with the original, a literal translation or an interpretation. AI translations are marked as drafts; untranslated passages keep the original.','遇見難句，可以對照原文、直譯與意譯。AI 譯文標為草稿；沒有譯文的地方，原文始終保留。','難しい文は、原文・直訳・意訳と見比べられます。AI 訳文は下書きと表示し、訳のない箇所には常に原文を残します。'],
  ['打开这本书','Open this book','打開這本書','この本を開く'],
  ['《爱丽丝梦游仙境》· 阅读示例','Alice’s Adventures in Wonderland · Reading example','《愛麗絲夢遊仙境》· 閱讀範例','『不思議の国のアリス』· 読書例'],
  ['中文意译 · 页面示例','Chinese interpretation · Reading example','中文意譯 · 頁面範例','中国語の意訳 · ページ例'],
  ['“一本书如果没有图画，也没有对话，那有什么用呢？”爱丽丝想。','“一本书如果没有图画，也没有对话，那有什么用呢？”爱丽丝想。','「一本書如果沒有圖畫，也沒有對話，那有什麼用呢？」愛麗絲想。','“一本书如果没有图画，也没有对话，那有什么用呢？”爱丽丝想。'],
  ['读到这里，你想起了什么？','What does this passage bring to mind?','讀到這裡，你想起了什麼？','この場面で、何を思い出しましたか？'],
  ['打开爱丽丝梦游仙境','Open Alice’s Adventures in Wonderland','打開愛麗絲夢遊仙境','不思議の国のアリスを開く'],
  // Daily story
  ['一张轻轻翻起的书页与布面书脊，Leafhour 品牌插画','A gently turning page and a clothbound spine, a Leafhour illustration','一張輕輕翻起的書頁與布面書脊，Leafhour 品牌插畫','そっとめくれる頁と布装の背、Leafhour のブランドイラスト'],
  ['让每一次回来，都有起点。','Have a place to return to.','讓每一次回來，都有起點。','戻る場所があれば、続けられる。'],
  ['读过的日子，<br>会留下痕迹。','The days you read<br>leave a trace.','讀過的日子，<br>會留下痕跡。','読んだ日々は、<br>痕跡を残します。'],
  ['今天读了哪里，写下什么，还有什么没想通，阅读日历都记下来。选择一天，就能回到那本书和那句话。','Your reading calendar keeps where you read, what you wrote and the questions still open. Choose a day to return to the book and the passage.','今天讀了哪裡，寫下什麼，還有什麼沒想通，閱讀日曆都記下來。選擇一天，就能回到那本書和那句話。','今日はどこを読み、何を書き、何がまだ腑に落ちないか。読書カレンダーが覚えていてくれます。日付を選ぶと、その本とその一節に戻れます。'],
  ['今天，读几页','Read a few pages today','今天，讀幾頁','今日は、数頁だけ'],
  ['每日陪读纸条','Daily reading notes','每日陪讀紙條','毎日の読書メモ'],
  ['选一个适合自己的每日目标，从上次的位置继续。','Choose a daily goal that fits your life and continue where you left off.','選一個適合自己的每日目標，從上次的位置繼續。','自分に合う毎日の目標を選び、前回の続きから読み進めます。'],
  ['读完，留一笔','Leave a thought afterward','讀完，留一筆','読み終えたら、ひとこと残す'],
  ['记录自己的理解，或标记真正读完的章节。','Write down your understanding, or mark a chapter you have finished.','記錄自己的理解，或標記真正讀完的章節。','自分の理解を書き留めるか、読み終えた章を記録します。'],
  ['明天，再回来','Come back tomorrow','明天，再回來','明日、また戻る'],
  ['时间与记录留在日历里，接着读下去。','Your time and thoughts stay in the calendar, ready to continue.','時間與記錄留在日曆裡，接著讀下去。','時間と思い出はカレンダーに残り、そのまま読み続けられます。'],
  ['阅读时间只记录前台停留。读完由你标记，理解也由你判断。','Reading time counts foreground visits only. You decide when you have finished and what you have understood.','閱讀時間只記錄前台停留。讀完由你標記，理解也由你判斷。','読書時間は画面に表示されている間だけ記録します。読み終えたかどうかも、理解できたかどうかも、あなたが決めます。'],
  ['打开我的阅读日历','Open my reading calendar','打開我的閱讀日曆','読書カレンダーを開く'],
  // Bookshelf
  ['选一本书','Choose a book','選一本書','本を選ぶ'],
  ['进入书房','Enter reading room','進入書房','書斎へ'],
  ['正在载入书架…','Opening the bookshelf…','正在載入書架…','本棚を開いています…'],
  ['默认书籍来自 Project Gutenberg，原文在美国属于公版；各书保留来源和许可说明，使用时请核对所在地规则。','The default books come from Project Gutenberg and are public domain in the United States. Source and license details are retained; check the rules where you live.','預設書籍來自 Project Gutenberg，原文在美國屬於公版；各書保留來源和許可說明，使用時請核對所在地規則。','既定の書籍は Project Gutenberg 由来で、原文は米国ではパブリックドメインです。出典と許諾の説明は各書に残してあります。お住まいの地域の規則をご確認ください。'],
  ['跟着白兔进入一个熟悉的陌生世界。','Follow the White Rabbit into a familiar, unfamiliar world.','跟著白兔進入一個熟悉的陌生世界。','白いウサギに続いて、見慣れた見知らぬ世界へ。'],
  ['写给自己的话，也留给每一个普通的今天。','Words written for oneself, and for an ordinary day.','寫給自己的話，也留給每一個普通的今天。','自分のために書いた言葉を、ありふれた今日のために。'],
  ['走进树林，重新观察生活的尺度。','Step into the woods and look at the scale of everyday life.','走進樹林，重新觀察生活的尺度。','森へ入って、暮らしのスケールを見直す。'],
  ['Marcus Aurelius · 英译 Meric Casaubon','Marcus Aurelius · translated by Meric Casaubon','Marcus Aurelius · 英譯 Meric Casaubon','Marcus Aurelius · 英訳 Meric Casaubon'],
  ['原文已保留。译文和思考，从这一页开始。','The original is here. Translation and your thoughts begin on this page.','原文已保留。譯文和思考，從這一頁開始。','原文はここにあります。訳文と自分の考えは、この頁から始まります。'],
  ['公版 · 英文原文','Public domain · English original','公版 · 英文原文','パブリックドメイン · 英語原文'],
  ['按需翻译','Translate on request','按需翻譯','翻訳はリクエスト時'],
  ['中文试读','Chinese sample','中文試讀','中国語の試し読み'],
  ['来源','Source','來源','出典'],
  ['继续阅读','Continue reading','繼續閱讀','読み続ける'],
  ['阅读','Read','閱讀','読む'],
  ['已提取','Extracted','已提取','抽出済み'],
  ['书架暂时无法连接，请稍后重试。','Unable to open the bookshelf. Please try again shortly.','書架暫時無法連接，請稍後重試。','本棚を開けませんでした。しばらくしてからもう一度お試しください。'],
  // Ownership
  ['一本书，<br>一间自己的书房。','One book.<br>A room of your own.','一本書，<br>一間自己的書房。','一冊の本、<br>自分だけの書斎。'],
  ['带来自己的 PDF、EPUB、Markdown 或纯文本。原文和译文各自保留，你写下的笔记也有自己的位置。','Bring your own PDF, EPUB, Markdown or text file. The original and translations are kept separately, with a place for your own notes.','帶來自己的 PDF、EPUB、Markdown 或純文字。原文和譯文各自保留，你寫下的筆記也有自己的位置。','自分の PDF・EPUB・Markdown・テキストを持ち込めます。原文と訳文は別々に保存され、書いたメモにも居場所があります。'],
  ['书籍与阅读记录按自己的账户保存。围绕原文提问时，助手的解释和自己的笔记分别保留。','Books and reading records belong to your account. When you ask about the text, the assistant’s explanation stays distinct from your notes.','書籍與閱讀記錄按自己的帳戶保存。圍繞原文提問時，助手的解釋和自己的筆記分別保留。','本と読書記録は自分のアカウントに保存されます。原文について質問するときも、アシスタントの説明と自分のメモは分けて残ります。'],
  ['Leafhour 以 AGPL-3.0 开源，可在本地运行或自行托管。','Leafhour is open source under AGPL-3.0 and can run locally or be self-hosted.','Leafhour 以 AGPL-3.0 開源，可在本地運行或自行託管。','Leafhour は AGPL-3.0 のオープンソースで、ローカル実行もセルフホストもできます。'],
  ['打开我的书房','Open my reading room','打開我的書房','自分の書斎を開く'],
  // Public questions
  ['开始之前，你也许想知道。','A few things before you begin.','開始之前，你也許想知道。','始める前に、知っておきたいこと。'],
  ['Leafhour 适合怎样的阅读？','What kind of reading is Leafhour for?','Leafhour 適合怎樣的閱讀？','Leafhour はどんな読書に向いていますか？'],
  ['Leafhour 是开源的 AI 辅助私人阅读书房。你可以持续阅读一本书，在原句旁留下高亮、理解与问题，需要时再请求翻译或和阅读助手对话。','Leafhour is an open-source AI reading room. Spend time with a whole book, keep highlights and questions beside the source, and request translation or conversation when you need it.','Leafhour 是開源的 AI 輔助私人閱讀書房。你可以持續閱讀一本書，在原句旁留下高亮、理解與問題，需要時再請求翻譯或和閱讀助手對話。','Leafhour はオープンソースの AI 読書室です。一冊の本とじっくり向き合い、原文のそばにハイライト・理解・疑問を残し、必要なときに翻訳や読書アシスタントとの対話を求められます。'],
  ['可以导入哪些格式？','What files can I import?','可以匯入哪些格式？','どんな形式を読み込めますか？'],
  ['目前支持 PDF、EPUB、Markdown（.md）和纯文本（.txt）。PDF 提取的文字需要与原稿核对；扫描页会在你确认后自动识别。EPUB 按内置阅读顺序提取，暂不支持加密或 DRM 版本。','PDF, EPUB, Markdown (.md) and plain text (.txt) are supported. Check extracted PDF text against the source; scanned pages are recognized automatically once you confirm. EPUB uses its embedded reading order; encrypted or DRM editions are not supported.','目前支援 PDF、EPUB、Markdown（.md）和純文字（.txt）。PDF 提取的文字需要與原稿核對；掃描頁會在你確認後自動識別。EPUB 按內置閱讀順序提取，暫不支援加密或 DRM 版本。','PDF・EPUB・Markdown（.md）・プレーンテキスト（.txt）に対応しています。PDF から抽出した文字は原稿と照合してください。スキャン頁は確認後に自動で認識します。EPUB は内部の読書順序で抽出します。暗号化・DRM 版には未対応です。'],
  ['原文、译文和自己的笔记怎样区分？','How are the original, translations and notes kept apart?','原文、譯文和自己的筆記怎樣區分？','原文・訳文・自分のメモはどのように分かれていますか？'],
  ['三者分别保存和展示。AI 译文标为草稿，没有译文时保留原文。公版样书预存了开头部分的中文译文，不表示全书已经翻译。','They are saved and displayed separately. AI translations are drafts, and untranslated passages retain the original. Public samples include Chinese translations of opening passages, not every page.','三者分別保存和展示。AI 譯文標為草稿，沒有譯文時保留原文。公版樣書預存了開頭部分的中文譯文，不表示全書已經翻譯。','それぞれ別に保存・表示されます。AI 訳文は下書き扱いで、訳のない箇所には原文が残ります。公開サンプルには冒頭部分の中国語訳が入っていますが、全頁が訳済みという意味ではありません。'],
  ['自己的 AI Agent 可以读书房吗？','Can my own AI agent read my books?','自己的 AI Agent 可以讀書房嗎？','自分の AI Agent に本を読ませられますか？'],
  ['外部 Agent 通过 MCP 按书籍和数据类型授权。原文、笔记、阅读记录与评论写入分别控制。当前是技术接入，网页尚无完整的授权管理入口，详见 ','External agents use MCP with permission for a specific book and selected data types. Content, notes, activity and comment writing have separate scopes. The web interface does not yet provide full grant management; see the ','外部 Agent 透過 MCP 按書籍和資料類型授權。原文、筆記、閱讀記錄與評論寫入分別控制。目前是技術接入，網頁尚無完整的授權管理入口，詳見 ','外部 Agent は MCP を通じて、特定の本と選んだデータ種別について許可を得て読みます。原文・メモ・読書記録・コメント書き込みは個別に制御します。現時点では技術的な接続で、権限管理の画面はまだありません。詳細は '],
  ['MCP 接入指南','MCP integration guide','MCP 串接指南','MCP 連携ガイド'],
  ['。站内阅读助手使用独立的只读边界，不读取私人笔记或写入阅读进度。','. The built-in reading assistant has separate read-only boundaries and does not read private notes or write reading progress.','。站內閱讀助手使用獨立的唯讀邊界，不讀取私人筆記或寫入閱讀進度。',' をご覧ください。組み込みの読書アシスタントは読み取り専用の境界を持ち、個人のメモを読んだり読書の進捗を書き込んだりしません。'],
  ['书籍与记录可以带走吗？','Can I take my books and records with me?','書籍與記錄可以帶走嗎？','本と記録は持ち出せますか？'],
  ['服务支持整库导出和恢复，不要求订阅。登录后在书房“设置 → 数据与迁移”下载 ZIP 备份、恢复书房或导出选定记录，原文件可自行选择是否纳入','Library export and restore do not require a subscription. After signing in, open Library → Settings → Data and migration for a ZIP backup, restore, or selected record export. Original files are optional','服務支援整庫匯出和恢復，不要求訂閱。登入後在書房「設定 → 資料與遷移」下載 ZIP 備份、恢復書房或匯出選定記錄，原始檔案可自行選擇是否納入','書庫全体の書き出しと復元に購読は不要です。ログイン後、書斎の「設定 → データと移行」で ZIP バックアップ、復元、選択した記録の書き出しができます。元ファイルの同梱は任意です'],
  ['。未同步的记录与草稿仍留在原浏览器，处理方式见 ','. Unsynced records and drafts remain in the original browser. See the ','。未同步的記錄與草稿仍留在原瀏覽器，處理方式見 ','。未同期の記録と未保存の下書きは元のブラウザに残ります。処理方法は '],
  ['隐私与数据说明','privacy and data notice','隱私與資料說明','プライバシーとデータの取り扱い'],
  ['使用 AI 和朋友共读有哪些限制？','What are the limits of AI and reading together?','使用 AI 和朋友共讀有哪些限制？','AI や一緒に読むことには、どんな制限がありますか？'],
  ['直接阅读公版样书不需要调用模型。翻译与对话需要配置模型服务，自托管时由运营者承担供应商费用。赠书信可以分享所选阅读材料；在线好友的实时共读仍是后续设想。','Reading public samples needs no model request. Translation and conversation need a configured model service; self-hosters bear provider charges. Gift letters can share selected reading material. Live reading together with online presence is a future idea.','直接閱讀公版樣書不需要調用模型。翻譯與對話需要配置模型服務，自託管時由營運者承擔供應商費用。贈書信可以分享所選閱讀材料；在線好友的實時共讀仍是後續設想。','公開サンプルを読むだけならモデルは呼び出しません。翻訳と対話にはモデルサービスの設定が必要で、セルフホストでは運営者が費用を負担します。贈り物の手紙で選んだ読書資料を共有できます。オンラインの友人とのリアルタイムな共読は、これからの構想です。'],
  ['网站支持哪些语言？','Which languages does the site support?','網站支援哪些語言？','対応言語は？'],
  ['官网、书房和阅读界面支持英文、简体中文、繁体中文和日语。界面语言可以在外观设置中切换，不会改变书籍原文或已有译文。','The website, reading room and reader support English, Simplified Chinese, Traditional Chinese and Japanese. Change the interface language in appearance settings; the book’s original text and existing translations stay unchanged.','官網、書房和閱讀介面支援英文、簡體中文、繁體中文和日語。介面語言可以在外觀設定中切換，不會改變書籍原文或既有譯文。','公式サイト、書斎、リーダーは英語・簡体字中国語・繁体字中国語・日本語に対応しています。外観設定で表示言語を変更できます。本の原文や保存済みの訳文は変わりません。'],
  // Closing and footer
  ['今天，就从几页开始。','Begin with a few pages today.','今天，就從幾頁開始。','今日は数頁から始めましょう。'],
  ['一本想读的书，一点留给自己的时间。','A book you want to read. A little time to yourself.','一本想讀的書，一點留給自己的時間。','読みたい一冊と、自分にあける少しの時間。'],
  ['关于 Leafhour','About Leafhour','關於 Leafhour','Leafhour について'],
  ['隐私说明','Privacy','隱私說明','プライバシー'],
  ['本地运行 · 可自托管','Runs locally · Self-hostable','本地運行 · 可自託管','ローカル実行 · セルフホスト対応'],
  ['开始阅读','Start reading','開始閱讀','読み始める'],
  ['先读几页','Read a few pages','先讀幾頁','まず数頁読む'],
  ['</a>。</p>','</a>.</p>','</a>。</p>','</a>。</p>'],
  // Sign-in dialog
  ['回到你的书房','Welcome back to your reading room','回到你的書房','書斎へようこそ'],
  ['从上次停下的地方继续。','Continue where you left off.','從上次停下的地方繼續。','前回の続きから読み進めます。'],
  ['验证你的邮箱','Verify your email','驗證你的郵箱','メールアドレスを確認'],
  ['设置登录密码','Set your password','設定登入密碼','ログインパスワードを設定'],
  ['创建你的书房','Create your reading room','創建你的書房','自分の書斎をつくる'],
  ['找回密码','Reset your password','找回密碼','パスワードを再設定'],
  ['下次，直接用密码进入。','Next time, sign in with your password.','下次，直接用密碼進入。','次回からパスワードで入れます。'],
  ['输入邮件中的 6 位验证码。','Enter the six-digit code from your email.','輸入郵件中的 6 位驗證碼。','メールに届いた 6 桁のコードを入力してください。'],
  ['验证邮箱后，设置你的登录密码。','Verify your email, then set your password.','驗證郵箱後，設定你的登入密碼。','メール確認後、ログインパスワードを設定してください。'],
  ['验证邮箱后，重新设置密码。','Verify your email, then choose a new password.','驗證郵箱後，重新設定密碼。','メール確認後、新しいパスワードを設定してください。'],
  ['不用密码，也能接着读。','Continue reading with an email code.','不用密碼，也能接著讀。','パスワードなしでも、メールコードで読み続けられます。'],
  ['邮箱或密码不正确','The email or password is incorrect','郵箱或密碼不正確','メールアドレスまたはパスワードが正しくありません'],
  ['网络暂时无法连接，请稍后重试。','Unable to connect. Please try again shortly.','網絡暫時無法連接，請稍後重試。','ネットワークに接続できません。しばらくしてからもう一度お試しください。'],
  ['暂时无法完成，请稍后重试。','Unable to complete this. Please try again shortly.','暫時無法完成，請稍後重試。','完了できませんでした。しばらくしてからもう一度お試しください。'],
  ['验证码已过期，请重新发送。','This code has expired. Request another one.','驗證碼已過期，請重新發送。','コードの有効期限が切れました。もう一度お送りしてください。'],
  ['验证码已过期','This code has expired','驗證碼已過期','コードの有効期限が切れました'],
  ['10 分钟内有效','Valid for ten minutes','10 分鐘內有效','10 分間有効'],
  ['正在发送验证码…','Sending your code…','正在發送驗證碼…','コードを送信しています…'],
  ['正在进入…','Signing in…','正在進入…','ログインしています…'],
  ['正在发送…','Sending…','正在發送…','送信しています…'],
  ['正在验证…','Verifying…','正在驗證…','確認しています…'],
  ['正在保存…','Saving…','正在保存…','保存しています…'],
  ['保存并进入书房','Save and enter reading room','保存並進入書房','保存して書斎へ'],
  ['验证邮箱','Verify email','驗證郵箱','メールを確認'],
  ['发送验证码','Send code','發送驗證碼','コードを送信'],
  ['重新发送','Resend','重新發送','再送信'],
  ['登录服务暂时不可用，可以先试读。','Sign-in is temporarily unavailable. You can still read a sample.','登入服務暫時不可用，可以先試讀。','ログインサービスを一時的に利用できません。サンプルは読めます。'],
  ['登录服务准备中，可以先试读。','Preparing sign-in. You can still read a sample.','登入服務準備中，可以先試讀。','ログインを準備中です。サンプルは読めます。'],
  ['登录 / 注册','Sign in / Sign up','登入 / 註冊','ログイン / 登録'],
  ['我的书房','My reading room','我的書房','自分の書斎'],
  ['新密码','New password','新密碼','新しいパスワード'],
  ['登录密码','sign-in password','登入密碼','ログインパスワード'],
  ['显示新密码','Show new password','顯示新密碼','新しいパスワードを表示'],
  ['隐藏新密码','Hide new password','隱藏新密碼','新しいパスワードを隠す'],
  ['显示登录密码','Show sign-in password','顯示登入密碼','ログインパスワードを表示'],
  ['隐藏登录密码','Hide sign-in password','隱藏登入密碼','ログインパスワードを隠す'],
  ['显示','Show','顯示','表示'],
  ['隐藏','Hide','隱藏','隠す'],
  ['至少 8 个字符。','At least eight characters.','至少 8 個字符。','8 文字以上。'],
  ['登录验证码','Email verification code','登入驗證碼','ログインコード'],
  ['更换邮箱','Change email','更換郵箱','メールアドレスを変更'],
  ['验证码登录','Use an email code','驗證碼登入','メールコードでログイン'],
  ['返回密码登录','Use a password','返回密碼登入','パスワードでログイン'],
  ['忘记密码？','Forgot password?','忘記密碼？','パスワードをお忘れですか？'],
  ['第一次来？','First time here?','第一次來？','初めての方へ'],
  ['创建书房','Create a reading room','創建書房','書斎をつくる'],
  ['先试读几页','Read a sample first','先試讀幾頁','まずサンプルを読む'],
  ['关闭登录','Close sign-in','關閉登入','ログインを閉じる'],
  ['使用 Google 登录','Sign in with Google','使用 Google 登入','Google でログイン'],
  ['使用 Apple 登录','Sign in with Apple','使用 Apple 登入','Apple でログイン'],
  ['准备中','Not available yet','準備中','準備中'],
  ['>或</span>','>or</span>','>或</span>','>または</span>'],
  ['>邮箱</label>','>Email</label>','>郵箱</label>','>メールアドレス</label>'],
  ['>密码</label>','>Password</label>','>密碼</label>','>パスワード</label>'],
  ['本机使用','On this computer','本機使用','このパソコンで'],
  ['进入本机书房','Open local reading room','進入本機書房','ローカルの書斎を開く'],
  ['仅在这台电脑使用，无需邮箱；与邮箱账户分开保存。','Use this computer without an email account. Local and email accounts keep separate data.','僅在這台電腦使用，無需郵箱；與郵箱帳戶分開保存。','メールアカウントなしでこのパソコンを使う方法です。ローカルとメールのアカウントは別々に保存されます。'],
  // Library shell and upload dialog shared with the public page
  ['收起侧栏','Collapse sidebar','收合側欄','サイドバーを折りたたむ'],
  ['搜索书籍','Search books','搜尋書籍','本を検索'],
  ['搜索与命令','Search and commands','搜尋與命令','検索とコマンド'],
  ['我上传的','My uploads','我上傳的','自分のアップロード'],
  ['阅读日历','Reading calendar','閱讀日曆','読書カレンダー'],
  ['阅读对话','Reading chat','閱讀對話','読書の対話'],
  ['带来一本书','Bring a book','帶來一本書','本を持ち込む'],
  ['回收站','Trash','回收站','ゴミ箱'],
  ['阅读习惯','Reading preferences','閱讀習慣','読書の好み'],
  ['设置阅读习惯','Set reading preferences','設定閱讀習慣','読書の好みを設定'],
  ['选好新书默认的阅读方式、译文与文字，之后打开的新书都从这里开始。每本书自己的选择仍然保留。','Choose the reading view, translation and typography for new books. Each book keeps its own saved choices.','選好新書預設的閱讀方式、譯文與文字，之後打開的新書都從這裡開始。每本書自己的選擇仍然保留。','新しく開く本の表示方法、訳文、文字の見た目を選びます。本ごとの設定はそのまま残ります。'],
  ['暂不设置','Set up later','暫不設定','あとで設定'],
  ['设置','Settings','設定','設定'],
  ['书籍筛选','Book filters','書籍篩選','本の絞り込み'],
  ['打开书房导航','Open reading room navigation','打開書房導覽','書斎メニューを開く'],
  ['筛选书架','Filter the bookshelf','篩選書架','本棚を絞り込む'],
  ['阅读状态','Reading status','閱讀狀態','読書状態'],
  ['书架','Bookshelf','書架','本棚'],
  ['阅读近况','Recent reading','閱讀近況','最近の読書'],
  ['书房导航','Reading room navigation','書房導覽','書斎メニュー'],
  ['全部','All','全部','すべて'],
  ['在读','Reading','在讀','読書中'],
  ['未读','Unread','未讀','未読'],
  ['读完','Finished','讀完','読み終えた'],
  ['搜索书名或作者','Search title or author','搜尋書名或作者','タイトル・著者を検索'],
  ['清空搜索','Clear search','清空搜尋','検索をクリア'],
  ['筛选','Filter','篩選','絞り込み'],
  ['筛选书籍','Filter books','篩選書籍','本を絞り込む'],
  ['清除筛选','Clear filters','清除篩選','絞り込みを解除'],
  ['主题','Topic','主題','テーマ'],
  ['全部主题','All topics','全部主題','すべてのテーマ'],
  ['全部来源','All sources','全部來源','すべての出典'],
  ['内置书','Built-in books','內置書','内蔵の本'],
  ['阅读语言','Reading language','閱讀語言','読む言語'],
  ['全部阅读语言','All reading languages','全部閱讀語言','すべての読書言語'],
  ['阅读形态','Reading format','閱讀形態','読む形式'],
  ['全部形态','All formats','全部形態','すべての形式'],
  ['原版','Original','原版','原文'],
  ['有译本','Translation available','有譯本','訳文あり'],
  ['双语对照','Bilingual','雙語對照','対訳'],
  ['有译本也可能只有部分段落，缺译处保留原文。','Translations may cover only some passages. Untranslated passages keep the original.','有譯本也可能只有部分段落，缺譯處保留原文。','訳文があるのは一部の段落だけの場合もあります。未翻訳の箇所には原文を表示します。'],
  ['完成','Done','完成','完了'],
  ['重新打开书房','Reopen the reading room','重新打開書房','書斎を開き直す'],
  ['正在打开书房…','Opening the reading room…','正在打開書房…','書斎を開いています…'],
  ['书架上的其他书','Other books on the shelf','書架上的其他書','本棚のその他の本'],
  ['还没有自己的书','No books of your own yet','還沒有自己的書','まだ自分の本がありません'],
  ['带来一份 PDF、EPUB、TXT 或 Markdown。','Bring a PDF, EPUB, TXT or Markdown file.','帶來一份 PDF、EPUB、TXT 或 Markdown。','PDF・EPUB・TXT・Markdown のファイルを持ち込めます。'],
  ['带来第一本书','Bring your first book','帶來第一本書','最初の本を持ち込む'],
  ['自己的书与阅读记录。','Your books and reading records.','自己的書與閱讀記錄。','自分の本と読書記録。'],
  ['先选一本书，读几页。','Choose a book and read a few pages.','先選一本書，讀幾頁。','一冊選んで、数頁読みます。'],
  ['拖动整本书调整位置，触屏可长按后移动。键盘聚焦调整位置按钮后使用左右方向键；更多操作中也可向前或向后移动。','Drag a book to reorder; on touchscreens, press and hold first. Focus the reorder button and use the arrow keys, or move a book forward or back in More actions.','拖動整本書調整位置，觸屏可長按後移動。鍵盤聚焦調整位置按鈕後使用左右方向鍵；更多操作中也可向前或向後移動。','本をドラッグして並べ替えます。タッチ操作では長押ししてから移動します。キーボードでは位置調整ボタンにフォーカスして左右の矢印キーを使うか、その他の操作から前後に移動できます。'],
  ['这次，你想读什么？','What would you like to read?','這次，你想讀什麼？','今回は、何を読みますか？'],
  ['原文件保存在自己的书房，提取后即可阅读。','The original file stays in your reading room; extracted text becomes readable.','原文件保存在自己的書房，提取後即可閱讀。','元のファイルは自分の書斎に保存され、抽出できたら読み進めます。'],
  ['拖放一本书，或点击选择','Drop a book here, or click to choose','拖放一本書，或點擊選擇','本をドロップするか、クリックして選択'],
  ['PDF 最多 256 MB · EPUB、TXT、Markdown 最多 20 MB','PDF up to 256 MB · EPUB, TXT and Markdown up to 20 MB','PDF 最多 256 MB · EPUB、TXT、Markdown 最多 20 MB','PDF は最大 256 MB · EPUB・TXT・Markdown は最大 20 MB'],
  ['自动整理文字版与扫描版。需要借助外部识别时，再由你确认；原文件始终保留。','Text and scanned editions are organized automatically. External recognition asks for your confirmation first; the original file is always kept.','自動整理文字版與掃描版。需要藉助外部識別時，再由你確認；原文件始終保留。','文字版とスキャン版を自動で整理します。外部の認識を使うときは確認を求めるので、元のファイルは常に残ります。'],
  ['放进我的书房','Put it in my reading room','放進我的書房','自分の書斎に入れる'],
  ['关闭上传','Close upload','關閉上傳','アップロードを閉じる'],
  ['选择 PDF、EPUB、TXT 或 Markdown 文件','Choose a PDF, EPUB, TXT or Markdown file','選擇 PDF、EPUB、TXT 或 Markdown 文件','PDF・EPUB・TXT・Markdown ファイルを選択'],
  // Appearance and sunlight controls
  ['暂停光影','Pause sunlight','暫停光影','陽光を一時停止'],
  ['开启光影','Enable sunlight','開啟光影','陽光を有効にする'],
  ['系统已减少动态效果','Reduced motion is enabled','系統已減少動態效果','視差効果を減らす設定です'],
  ['>光影</span>','>Sunlight</span>','>光影</span>','>陽光</span>'],
  ['切换页面外观','Change appearance','切換頁面外觀','外観を切り替える']
];
// Rows [source, English, Traditional Chinese, Japanese] for messages that come
// back from the sign-in service. Unknown future messages keep a safe fallback.
const authErrorRows=[
  ['邮箱或密码不正确，请重试或使用验证码登录','The email or password is incorrect. Try again or use an email code.','郵箱或密碼不正確，請重試或使用驗證碼登入','メールアドレスまたはパスワードが正しくありません。もう一度試すか、メールコードでログインしてください。'],
  ['请先验证邮箱，也可以使用验证码登录','Verify your email first, or sign in with an email code.','請先驗證郵箱，也可以使用驗證碼登入','先にメールアドレスを確認してください。メールコードでのログインもできます。'],
  ['验证码不正确或已过期，请重新获取','The code is incorrect or has expired. Request another one.','驗證碼不正確或已過期，請重新取得','コードが正しくないか、期限が切れています。もう一度お取得ください。'],
  ['验证码未能验证，请核对邮件里的数字','The code could not be verified. Check the digits in your email.','驗證碼未能驗證，請核對郵件裡的數字','コードを確認できませんでした。メールの数字をご確認ください。'],
  ['验证码邮件暂时无法发出，请稍后重试','The code email could not be sent. Please try again later.','驗證碼郵件暫時無法發出，請稍後重試','コードのメールを送信できませんでした。しばらくしてからもう一度お試しください。'],
  ['邮件暂时未能发出，请稍后再试','The code email could not be sent. Please try again later.','郵件暫時未能發出，請稍後再試','メールを送信できませんでした。しばらくしてからもう一度お試しください。'],
  ['邮件发送暂未确认，请稍后查看邮箱再重试','Email delivery is not yet confirmed. Check your inbox before trying again.','郵件發送暫未確認，請稍後查看郵箱再重試','メールの送信をまだ確認できていません。受信をご確認のうえ、もう一度お試しください。'],
  ['新密码与原密码相同，请换一个','This is your current password. Choose a different one.','新密碼與原密碼相同，請換一個','現在のパスワードと同じです。別のものを選んでください。'],
  ['这个密码不够安全，请换一个较长的密码','This password is too weak. Choose a longer password.','這個密碼不夠安全，請換一個較長的密碼','このパスワードは安全性が足りません。長いものを選んでください。'],
  ['请设置至少 8 个字符的密码','Choose a password with at least eight characters.','請設定至少 8 個字符的密碼','8 文字以上のパスワードを設定してください。'],
  ['密码暂未保存，请重试或重新验证邮箱','Your password has not been saved. Try again or verify your email again.','密碼暫未保存，請重試或重新驗證郵箱','パスワードはまだ保存されていません。もう一度試すか、メールを再確認してください。'],
  ['请输入密码','Enter your password.','請輸入密碼','パスワードを入力してください。'],
  ['请输入有效的邮箱地址','Enter a valid email address.','請輸入有效的郵箱地址','有効なメールアドレスを入力してください。'],
  ['请输入邮件里的验证码','Enter the verification code from your email.','請輸入郵件裡的驗證碼','メールの認証コードを入力してください。'],
  ['请输入邮件里的六位验证码','Enter the six-digit code from your email.','請輸入郵件裡的六位驗證碼','メールの 6 桁コードを入力してください。'],
  ['请稍后再获取验证码','Wait before requesting another code.','請稍後再取得驗證碼','しばらく待ってからコードを取得してください。'],
  ['请一分钟后再获取验证码','Wait one minute before requesting another code.','請一分鐘後再取得驗證碼','1 分後にコードを取得してください。'],
  ['请求较频繁，请稍后再试','Too many requests. Please try again later.','請求較頻繁，請稍後再試','リクエストが多すぎます。しばらくしてからもう一度お試しください。'],
  ['邮件请求较多，请稍后再试','Too many email requests. Please try again later.','郵件請求較多，請稍後再試','メールのリクエストが多すぎます。しばらくしてからもう一度お試しください。'],
  ['验证码请求较多，请稍后再试','Too many code requests. Please try again later.','驗證碼請求較多，請稍後再試','コードのリクエストが多すぎます。しばらくしてからもう一度お試しください。'],
  ['登录尝试较多，请稍后再试，也可以使用验证码登录','Too many sign-in attempts. Try again later or use an email code.','登入嘗試較多，請稍後再試，也可以使用驗證碼登入','ログイン試行の回数が多すぎます。しばらくしてからもう一度試すか、メールコードをご利用ください。'],
  ['请重新验证邮箱后设置密码','Verify your email again before setting your password.','請重新驗證郵箱後設定密碼','パスワードを設定する前に、メールを再確認してください。'],
  ['这次邮箱验证与当前账户不一致，请重新验证','This email verification does not match the current account. Verify your email again.','這次郵箱驗證與當前帳戶不一致，請重新驗證','このメール確認は現在のアカウントと一致しません。もう一度確認してください。'],
  ['这次验证已用于保存密码，请尝试密码登录或重新验证邮箱','This verification has already been used. Sign in with your password or verify your email again.','這次驗證已用於保存密碼，請嘗試密碼登入或重新驗證郵箱','この確認はすでに使用されています。パスワードでログインするか、メールを再確認してください。'],
  ['邮箱验证已过期，请重新验证后设置密码','Email verification has expired. Verify your email again before setting your password.','郵箱驗證已過期，請重新驗證後設定密碼','メール確認の有効期限が切れました。再確認後にパスワードを設定してください。'],
  ['登录服务暂时无法连接，请稍后重试','Unable to reach the sign-in service. Please try again later.','登入服務暫時無法連接，請稍後重試','ログインサービスに接続できません。しばらくしてからもう一度お試しください。'],
  ['登录服务暂时不可用，请稍后重试','Sign-in is temporarily unavailable. Please try again later.','登入服務暫時不可用，請稍後重試','ログインサービスを一時的に利用できません。しばらくしてからもう一度お試しください。'],
  ['登录已失效，请重新进入','Your session has expired. Please sign in again.','登入已失效，請重新進入','セッションの有効期限が切れました。もう一度ログインしてください。'],
  ['登录未能完成，请重新尝试','Sign-in could not be completed. Please try again.','登入未能完成，請重新嘗試','ログインを完了できませんでした。もう一度お試しください。'],
  ['登录信息未能确认，请重新尝试','Your sign-in could not be confirmed. Please try again.','登入信息未能確認，請重新嘗試','ログイン情報を確認できませんでした。もう一度お試しください。'],
  ['这个登录方式正在准备中，请使用其他方式','This sign-in method is not available yet. Choose another method.','這個登入方式正在準備中，請使用其他方式','このログイン方法はまだ利用できません。別の方法をお選びください。'],
  ['这个登录方式正在准备中','This sign-in method is not available yet. Choose another method.','這個登入方式正在準備中','このログイン方法はまだ利用できません。'],
  ['邮箱登录正在准备中。你可以先试读公版书。','Email sign-in is not available yet. You can read a public sample first.','郵箱登入正在準備中。你可以先試讀公版書。','メールログインはまだ準備中です。公開サンプルは先にお読みいただけます。'],
  ['邮箱服务尚未配置。现在可以试读，或进入本机书房。','Email sign-in is not configured. Read a sample or use the local reading room.','郵箱服務尚未配置。現在可以試讀，或進入本機書房。','メールサービスは未設定です。サンプルを読むか、ローカルの書斎をお使いください。'],
  ['此书房尚未开启密码登录，可以使用验证码或本机书房','Password sign-in is not enabled. Use an email code or the local reading room.','此書房尚未開啟密碼登入，可以使用驗證碼或本機書房','この書斎ではパスワードログインが有効になっていません。メールコードかローカルの書斎をご利用ください。'],
  ['此书房尚未开启密码设置','Password setup is not enabled for this reading room.','此書房尚未開啟密碼設定','この書斎ではパスワード設定が有効になっていません。']
];
// Numbers arrive after mount: rows are [pattern, English, Traditional Chinese, Japanese].
const dynamicRows=[
  [/(\d+) 秒后重发/g,'Resend in $1s','$1 秒後重發','$1秒後に再送信'],
  [/(\d+) 秒后重试/g,'Try again in $1s','$1 秒後重試','$1秒後にもう一度'],
  [/(\d+) 秒后可发送/g,'Send in $1s','$1 秒後可發送','$1秒後に送信可能'],
  [/双译开篇 · (\d+) 段/g,'Two translations · $1 opening passages','雙譯開篇 · $1 段','二つの訳 · 冒頭$1段'],
  [/自己的书 · /g,'A book of my own · ','自己的書 · ','自分の本 · '],
  [/(\d+) 段/g,'$1 passages','$1 段','$1段']
];
// The public pages live at one URL per language; English is the default.
export const homeLocales=[
  {code:'en',htmlLang:'en',route:'/',label:'English'},
  {code:'zh-Hans',htmlLang:'zh-Hans',route:'/zh-hans',label:'简体中文'},
  {code:'zh-Hant',htmlLang:'zh-Hant',route:'/zh-hant',label:'繁體中文'},
  {code:'ja',htmlLang:'ja',route:'/ja',label:'日本語'}
];
const columns={en:1,'zh-Hant':2,ja:3};
// Exported for the catalog completeness tests only.
export const homeStringRows=strings,homeAuthErrorRows=authErrorRows;
const build=rows=>{
  const maps={};
  for(const code of Object.keys(columns)){const map=new Map();for(const row of rows)if(row[0]&&row[columns[code]])map.set(row[0],row[columns[code]]);maps[code]=map;}
  return maps;
};
const messages=build(strings),authMessages=build(authErrorRows);
const escaped=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const pattern=new RegExp([...strings].map(row=>row[0]).filter(Boolean).sort((a,b)=>b.length-a.length).map(escaped).join('|'),'g');
export const homeLocale=doc=>{
  const lang=doc?.documentElement?.lang||'';
  if(lang.startsWith('en'))return 'en';
  if(lang.startsWith('ja'))return 'ja';
  if(/^zh-(?:hant|tw|hk|mo)/i.test(lang))return 'zh-Hant';
  return 'zh-Hans';
};
export function homeText(value,locale){
  if(typeof value!=='string')return value;
  const map=messages[locale];
  if(!map)return value;
  // One pass avoids translating generated output a second time.
  let text=value.replace(pattern,match=>map.get(match)||match);
  if(locale==='zh-Hans')return value;
  for(const row of dynamicRows)text=text.replace(row[0],row[columns[locale]]);
  return text;
}
export function authErrorText(value,locale){
  if(typeof value!=='string')return value;
  const map=authMessages[locale]||messages[locale];
  const translated=(map&&map.get(value))||homeText(value,locale);
  // Keep future service messages readable without leaking source text into a
  // localized UI. Traditional Chinese readers can still read a source fallback.
  if(locale==='en'&&/\p{Script=Han}/u.test(translated))return 'Unable to complete sign-in. Please try again or choose another sign-in method.';
  if(locale==='ja'&&translated===value&&/\p{Script=Han}/u.test(value))return 'ログインを完了できませんでした。もう一度試すか、別のログイン方法をお選びください。';
  return translated;
}
const site='https://leafhour.com';
export function homeLocaleMeta(locale){
  const meta=homeLocales.find(row=>row.code===locale)||homeLocales[1];
  return {...meta,canonical:site+meta.route,url:site+meta.route};
}
export function homeDocument(source,locale){
  const meta=homeLocaleMeta(locale);
  const choiceRoute=meta.code==='en'?'/en':meta.route;
  const commerceLabels=({'en':['Pricing','Terms','Refunds'],'zh-Hans':['价格','服务条款','退款政策'],'zh-Hant':['價格','服務條款','退款政策'],'ja':['料金','利用規約','返金ポリシー']})[meta.code];
  const commerceLinks='<nav class="home-commerce-links" aria-label="'+commerceLabels[0]+'">'+['pricing','terms','refunds'].map((kind,index)=>'<a href="'+(meta.code==='en'?'/en':meta.route)+'/'+kind+'">'+commerceLabels[index]+'</a>').join(' · ')+'</nav>';
  return homeText(source,locale)
    .replace(/<nav class="home-navigation"[^>]*>[\s\S]*?<\/nav>/,publicNavigation({locale:meta.code}))
    .replace(/<nav class="home-commerce-links"[^>]*>[\s\S]*?<\/nav>/g,'')
    .replace('</footer>',commerceLinks+'</footer>')
    // The root is automatic; an explicit English language choice uses /en.
    .replaceAll('href="/" lang="en"','href="/en" lang="en"')
    // Only trusted, authored navigation anchors are owned here. Include the
    // first paint so denied storage or an early click cannot lose the route's
    // language; source prose, external links and resource URLs stay literal.
    .replace(/(<a\b[^>]*\bhref=")(\/(?:library|read)(?:[?#][^"]*)?)(")/g,(_,before,href,after)=>before+withUiParam(href.replaceAll('&amp;','&'),meta.code).replaceAll('&','&amp;')+after)
    .replace('<html lang="zh-Hans">','<html lang="'+meta.htmlLang+'">')
    .replace('<link rel="canonical" href="https://leafhour.com/">','<link rel="canonical" href="'+meta.canonical+'">')
    .replace('<meta property="og:url" content="https://leafhour.com/">','<meta property="og:url" content="'+meta.canonical+'">')
    .replaceAll('class="brand" href="/"','class="brand" href="'+choiceRoute+'"')
    .replaceAll('href="/mcp"','href="'+(meta.route==='/'?'/mcp':meta.route+'/mcp')+'"')
    .replaceAll('href="/privacy"','href="'+(meta.route==='/'?'/privacy':meta.route+'/privacy')+'"')
    .replaceAll('href="'+choiceRoute+'" lang="'+meta.htmlLang+'"','aria-current="true" href="'+choiceRoute+'" lang="'+meta.htmlLang+'"')
    .replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,(_,json)=>{
      const data=JSON.parse(json);
      for(const node of data['@graph']||[])if(node['@type']==='WebPage'){node['@id']=meta.url+'#page';node.url=meta.url;node.inLanguage=meta.htmlLang;}
      return '<script type="application/ld+json">'+JSON.stringify(data)+'</script>';
    });
}
