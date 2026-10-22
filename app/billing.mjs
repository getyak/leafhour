import {commerceLocale,commerceCopy,commercePath,escapeBilling as escape} from './commerce-pages.mjs';

const copy={
 en:{title:'Points & billing',admin:'Billing overview',back:'Back to your reading room',loading:'Opening your billing account…',retry:'Refresh',signIn:'Sign in to view your points',signInBody:'Balances and orders are private to your account.',available:'Available points',reserved:'Reserved',consumed:'Consumed',granted:'Total granted',sources:'Point sources',trial:'10 trial points',trialYes:'Trial already granted',trialNo:'Claim 10 trial points',trialHelp:'One grant per verified account. The server checks eligibility.',frozen:'Paid generation is paused while a payment issue is reviewed. Reading and export remain available. Contact support.',entries:'Point statement',orders:'Orders',emptyEntries:'No point entries yet.',emptyOrders:'No orders yet.',date:'Date',feature:'Feature / entry',points:'Points',reference:'Reference',state:'State',amount:'Amount',order:'Order',receipt:'Creem receipt',more:'Load more',buy:'Buy 100 points · US$5',buyTest:'Test checkout · 100 points',checking:'Checking payment with the server…',paid:'Payment verified. Points have been granted.',pending:'Payment is not yet verified. This page does not grant points from a return URL. You can refresh later.',refund:'Refund recorded',disputed:'Payment under review',cancelled:'Cancelled',failed:'Failed',hold:'Processing · reserved',consume:'Consumed',release:'Not charged · released',reversal:'Points returned',grant:'Granted',refund_adjustment:'Refund adjustment',trialGrant:'Trial grant',purchaseGrant:'Purchase grant',translation:'Dual translation',conversation:'Reading question',annotation:'AI annotation',unknown:'Not reported',disabled:'Payments are not open. Reading and export remain available.',test:'Test mode — sandbox checkout only. No real payment or production points.',unavailable:'Payments are unavailable: server readiness checks have not passed.',live:'One payment. No automatic renewal. Any tax and final total appear at Creem checkout.',error:'Billing could not be loaded. Please try again.',forbidden:'This account does not have permission to view the billing overview.',changed:'Your account changed. Private billing data was cleared. Refresh to continue.',signInRequired:'Sign in again to continue.',checkoutError:'Checkout is unavailable. Your existing points and reading data are unchanged.',trialError:'Trial points could not be granted. The account must be verified and eligible.',accounts:'Accounts',paidOrders:'Paid orders',paidUsers:'Paying accounts',sales:'Cash collected by currency',refunds:'Refunds by currency',calls:'Supplier calls',knownCost:'Known supplier cost · USD',unknownCost:'calls with unknown or partial supplier costs',costNote:'Missing usage remains unknown. Known supplier cost is a partial measurement when any call lacks complete usage. Cash collected is separate from point consumption and accounting revenue.',emptyCurrency:'No recorded amounts.',from:'From date (Shanghai)',to:'To date (exclusive, Shanghai)',range:'Asia/Shanghai · half-open time window: start inclusive, end exclusive.',apply:'Show report',report:'Report window',noSummary:'Choose a time window to load real billing aggregates.',unitsNote:'1 point = 1,000,000 accounting units. Reservations are separate from consumption.',free:'Reading, notes and export remain free.',support:'Need help?',privacy:'Privacy',operator:'Operator report',timeError:'Choose a valid date range, with the end after the start.'},
 'zh-Hans':{title:'额度与账单',admin:'计费概览',back:'返回自己的书房',loading:'正在打开额度账户…',retry:'刷新',signIn:'登录后查看自己的额度',signInBody:'余额与订单仅对当前账户可见。',available:'可用阅读点',reserved:'处理中预留',consumed:'已消费',granted:'累计发放',sources:'点数来源',trial:'10 试用点',trialYes:'已领取试用点',trialNo:'领取 10 试用点',trialHelp:'每个验证账户一次，由服务端核验资格。',frozen:'支付问题核对期间已暂停收费生成。阅读和导出仍可使用，请联系支持。',entries:'点数明细',orders:'订单',emptyEntries:'还没有点数分录。',emptyOrders:'还没有订单。',date:'时间',feature:'功能 / 分录',points:'点数',reference:'关联编号',state:'状态',amount:'金额',order:'订单',receipt:'Creem 凭证',more:'加载更多',buy:'购买 100 点 · US$5',buyTest:'测试结账 · 100 点',checking:'正在向服务端核对付款…',paid:'付款已核实，点数已到账。',pending:'付款尚未核实。返回页参数不会发放点数，可稍后刷新查看。',refund:'已记录退款',disputed:'付款核对中',cancelled:'已取消',failed:'失败',hold:'处理中 · 已预留',consume:'已消费',release:'未扣点 · 已释放',reversal:'点数已退回',grant:'已发放',refund_adjustment:'退款调整',trialGrant:'试用赠送',purchaseGrant:'购买到账',translation:'单段双译',conversation:'阅读对话',annotation:'AI 注解',unknown:'未报告',disabled:'支付尚未开放，阅读和导出仍可使用。',test:'测试模式：仅沙盒结账，不涉及真实付款或正式点数。',unavailable:'支付暂不可用：服务端就绪检查尚未通过。',live:'一次性购买，无自动续费。税费及最终总额以 Creem 结账页为准。',error:'暂时无法载入账单，请稍后重试。',forbidden:'当前账户无权查看运营计费概览。',changed:'账户已变化，原账户的账单资料已清除。请刷新后继续。',signInRequired:'请重新登录后继续。',checkoutError:'目前无法结账，已有点数与阅读资料保持不变。',trialError:'暂时无法领取试用点，账户须通过验证并符合资格。',accounts:'账户数',paidOrders:'已付款订单',paidUsers:'付款账户',sales:'按币种收款',refunds:'按币种退款',calls:'供应商调用',knownCost:'已知供应商成本 · USD',unknownCost:'次调用成本未知或不完整',costNote:'缺失用量保持未知。只要有调用缺少完整用量，已知供应商成本就是部分计量。现金收款、点数消费和会计收入分别记录。',emptyCurrency:'还没有金额记录。',from:'开始日期（上海）',to:'结束日期（不含，上海）',range:'Asia/Shanghai · 半开时间窗：包含开始，不包含结束。',apply:'查看报表',report:'报表时间窗',noSummary:'选择时间范围，载入真实计费汇总。',unitsNote:'1 点 = 1,000,000 记账单位。预留与正式消费分开。',free:'阅读、笔记与导出仍然免费。',support:'需要帮助？',privacy:'隐私说明',operator:'运营报表',timeError:'请选择有效日期范围，结束日期须晚于开始日期。'},
 'zh-Hant':{title:'額度與帳單',admin:'計費概覽',back:'返回自己的書房',loading:'正在開啟額度帳戶…',retry:'重新整理',signIn:'登入後查看自己的額度',signInBody:'餘額與訂單僅對目前帳戶可見。',available:'可用閱讀點',reserved:'處理中預留',consumed:'已消費',granted:'累計發放',sources:'點數來源',trial:'10 試用點',trialYes:'已領取試用點',trialNo:'領取 10 試用點',trialHelp:'每個驗證帳戶一次，由伺服器核驗資格。',frozen:'付款問題核對期間已暫停收費生成。閱讀和匯出仍可使用，請聯絡支援。',entries:'點數明細',orders:'訂單',emptyEntries:'還沒有點數分錄。',emptyOrders:'還沒有訂單。',date:'時間',feature:'功能 / 分錄',points:'點數',reference:'關聯編號',state:'狀態',amount:'金額',order:'訂單',receipt:'Creem 憑證',more:'載入更多',buy:'購買 100 點 · US$5',buyTest:'測試結帳 · 100 點',checking:'正在向伺服器核對付款…',paid:'付款已核實，點數已入帳。',pending:'付款尚未核實。返回頁參數不會發放點數，可稍後重新整理查看。',refund:'已記錄退款',disputed:'付款核對中',cancelled:'已取消',failed:'失敗',hold:'處理中 · 已預留',consume:'已消費',release:'未扣點 · 已釋放',reversal:'點數已退回',grant:'已發放',refund_adjustment:'退款調整',trialGrant:'試用贈送',purchaseGrant:'購買入帳',translation:'單段雙譯',conversation:'閱讀對話',annotation:'AI 註解',unknown:'未報告',disabled:'付款尚未開放，閱讀和匯出仍可使用。',test:'測試模式：僅沙盒結帳，不涉及真實付款或正式點數。',unavailable:'付款暫不可用：伺服器就緒檢查尚未通過。',live:'一次性購買，無自動續費。稅費及最終總額以 Creem 結帳頁為準。',error:'暫時無法載入帳單，請稍後重試。',forbidden:'目前帳戶無權查看營運計費概覽。',changed:'帳戶已變更，原帳戶的帳單資料已清除。請重新整理後繼續。',signInRequired:'請重新登入後繼續。',checkoutError:'目前無法結帳，已有點數與閱讀資料保持不變。',trialError:'暫時無法領取試用點，帳戶須通過驗證並符合資格。',accounts:'帳戶數',paidOrders:'已付款訂單',paidUsers:'付款帳戶',sales:'按幣別收款',refunds:'按幣別退款',calls:'供應商呼叫',knownCost:'已知供應商成本 · USD',unknownCost:'次呼叫成本未知或不完整',costNote:'缺少用量維持未知。只要有呼叫缺少完整用量，已知供應商成本就是部分計量。現金收款、點數消費和會計收入分別記錄。',emptyCurrency:'還沒有金額記錄。',from:'開始日期（上海）',to:'結束日期（不含，上海）',range:'Asia/Shanghai · 半開時間窗：包含開始，不包含結束。',apply:'查看報表',report:'報表時間窗',noSummary:'選擇時間範圍，載入真實計費彙總。',unitsNote:'1 點 = 1,000,000 記帳單位。預留與正式消費分開。',free:'閱讀、筆記與匯出仍然免費。',support:'需要協助？',privacy:'隱私說明',operator:'營運報表',timeError:'請選擇有效日期範圍，結束日期須晚於開始日期。'},
 ja:{title:'ポイントと請求',admin:'請求の概要',back:'自分の読書室に戻る',loading:'ポイントを読み込み中…',retry:'更新',signIn:'ログインしてポイントを確認',signInBody:'残高と注文は自分のアカウントだけに表示されます。',available:'利用可能ポイント',reserved:'処理中の確保',consumed:'消費済み',granted:'累計付与',sources:'ポイントの内訳',trial:'10 お試しポイント',trialYes:'お試しポイント付与済み',trialNo:'10 お試しポイントを受け取る',trialHelp:'認証済みアカウントごとに 1 回。サーバーで資格を確認します。',frozen:'支払いを確認中のため有料生成を停止しています。読書とエクスポートは利用できます。サポートへお問い合わせください。',entries:'ポイント明細',orders:'注文',emptyEntries:'ポイントの記録はまだありません。',emptyOrders:'注文はまだありません。',date:'日時',feature:'機能 / 記録',points:'ポイント',reference:'参照 ID',state:'状態',amount:'金額',order:'注文',receipt:'Creem 領収書',more:'さらに読み込む',buy:'100 ポイントを購入 · US$5',buyTest:'テスト決済 · 100 ポイント',checking:'サーバーで支払いを確認中…',paid:'支払いを確認し、ポイントを付与しました。',pending:'支払いはまだ確認されていません。URL の情報だけでは付与しません。後で更新できます。',refund:'返金を記録済み',disputed:'支払いを確認中',cancelled:'キャンセル済み',failed:'失敗',hold:'処理中 · 確保済み',consume:'消費済み',release:'消費なし · 解放済み',reversal:'ポイント返還',grant:'付与',refund_adjustment:'返金調整',trialGrant:'お試し付与',purchaseGrant:'購入分付与',translation:'直訳と意訳',conversation:'読書対話',annotation:'AI 注釈',unknown:'未報告',disabled:'支払いはまだ開始していません。読書とエクスポートは利用できます。',test:'テストモード：サンドボックス決済のみ。実際の支払いや本番ポイントは発生しません。',unavailable:'サーバーの準備確認が完了していないため、支払いは利用できません。',live:'1 回限りの購入。自動更新はありません。税と最終金額は Creem 決済画面に表示します。',error:'請求情報を読み込めませんでした。再試行してください。',forbidden:'このアカウントには運営用の請求概要へのアクセス権がありません。',changed:'アカウントが変わったため、前の請求情報を消去しました。更新して続けてください。',signInRequired:'再度ログインしてください。',checkoutError:'現在は決済を利用できません。既存のポイントと読書記録は維持されます。',trialError:'お試しポイントを付与できませんでした。認証と利用資格が必要です。',accounts:'アカウント数',paidOrders:'支払済み注文',paidUsers:'支払い済みアカウント',sales:'通貨別の入金',refunds:'通貨別の返金',calls:'サプライヤー呼び出し',knownCost:'判明したサプライヤー費用 · USD',unknownCost:'件の費用が不明または不完全',costNote:'用量が不明な場合は不明のまま表示します。完全な用量がない呼び出しがあれば、既知の費用は部分的な計測です。入金、ポイント消費、会計上の収益は別に記録します。',emptyCurrency:'金額の記録はありません。',from:'開始日（上海）',to:'終了日（含まない・上海）',range:'Asia/Shanghai · 半開区間：開始を含み、終了を含みません。',apply:'レポートを表示',report:'集計期間',noSummary:'期間を指定して実際の請求集計を読み込みます。',unitsNote:'1 ポイント = 1,000,000 記帳単位。確保と消費は区別します。',free:'読書、ノート、エクスポートは引き続き無料です。',support:'お問い合わせ',privacy:'プライバシー',operator:'運営レポート',timeError:'有効な日付範囲を選択してください。終了日は開始日より後にします。'}
};
const reportingCopy={
 en:{trialSource:'Trial points',purchaseSource:'Purchased points',reviewSource:'Review points',fundingTitle:'Calls by funding',featureTitle:'Calls by feature',sourceTitle:'Points by source',category:'Category',unknownCalls:'Unknown cost calls',known:'Known cost · USD',sponsored:'Sponsored',userFunded:'User-requested points',operatorFunded:'Operator-funded',fees:'Payment fees',reviewOrders:'Review orders',trialGrants:'Trial grants',operations:'Operation states',settled:'Settled',running:'Running',result_saved:'Result saved',released:'Released',reservedState:'Reserved'},
 'zh-Hans':{trialSource:'试用点',purchaseSource:'购买点',reviewSource:'审核点',fundingTitle:'按资金来源统计调用',featureTitle:'按功能统计调用',sourceTitle:'按来源统计点数',category:'类别',unknownCalls:'成本未知调用',known:'已知成本 · USD',sponsored:'平台赞助',userFunded:'用户主动用点',operatorFunded:'运营者承担',fees:'支付手续费',reviewOrders:'审核订单',trialGrants:'试用发放',operations:'任务状态',settled:'已结算',running:'处理中',result_saved:'结果已保存',released:'已释放',reservedState:'已预留'},
 'zh-Hant':{trialSource:'試用點',purchaseSource:'購買點',reviewSource:'審核點',fundingTitle:'按資金來源統計呼叫',featureTitle:'按功能統計呼叫',sourceTitle:'按來源統計點數',category:'類別',unknownCalls:'成本未知呼叫',known:'已知成本 · USD',sponsored:'平台贊助',userFunded:'使用者主動用點',operatorFunded:'營運者承擔',fees:'付款手續費',reviewOrders:'審核訂單',trialGrants:'試用發放',operations:'任務狀態',settled:'已結算',running:'處理中',result_saved:'結果已儲存',released:'已釋放',reservedState:'已預留'},
 ja:{trialSource:'お試しポイント',purchaseSource:'購入ポイント',reviewSource:'審査用ポイント',fundingTitle:'費用負担別の呼び出し',featureTitle:'機能別の呼び出し',sourceTitle:'種類別ポイント',category:'種類',unknownCalls:'費用不明の呼び出し',known:'既知の費用 · USD',sponsored:'運営負担',userFunded:'利用者のポイント',operatorFunded:'運営者の費用負担',fees:'決済手数料',reviewOrders:'審査用注文',trialGrants:'お試し付与',operations:'処理状態',settled:'決済済み',running:'処理中',result_saved:'結果を保存済み',released:'解放済み',reservedState:'確保済み'}
};
const subscriptionCopy={
 en:{subscribe:'Subscribe · US$5 / month',subscribeTest:'Test monthly subscription · US$5 / month',monthlyLive:'Monthly automatic renewal. Applicable tax and the final total appear at Creem checkout.',subscriptions:'Monthly subscription',noSubscriptions:'No monthly subscription.',subscriptionUnknown:'Refresh to check your subscription before starting a monthly plan.',subscriptionExists:'A monthly subscription or checkout already exists. Manage it below or refresh to check its status.',subscriptionStatus:'Status',active:'Active',trialing:'Trial period',past_due:'Payment overdue',unpaid:'Payment unpaid',paused:'Paused',scheduled_cancel:'Cancellation scheduled',canceled:'Cancelled',currentPeriodEnds:'Current period ends',nextPayment:'Next payment',manage:'Manage / cancel renewal',portalError:'The customer portal could not be opened. Refresh or contact support.',trialHelp:'Eligible verified accounts receive 10 points automatically once, subject to campaign funds.',trialBudget:'Trial campaign funds are unavailable. Purchased points can still be used.',trialVerification:'Verify your account to receive the once-only trial points.',retryTrial:'Retry trial grant',renewalNote:'Cancelling in the customer portal stops future renewal. Points already delivered remain in your balance.'},
 'zh-Hans':{subscribe:'订阅 · US$5 / 月',subscribeTest:'测试月付订阅 · US$5 / 月',monthlyLive:'按月自动续费。适用税费与最终总额以 Creem 结账页为准。',subscriptions:'月付订阅',noSubscriptions:'还没有月付订阅。',subscriptionUnknown:'请刷新核对已有订阅，再开通月付方案。',subscriptionExists:'已有月付订阅或待确认结账。可在下方管理，或刷新核对状态。',subscriptionStatus:'状态',active:'生效中',trialing:'试用期',past_due:'付款逾期',unpaid:'尚未付款',paused:'已暂停',scheduled_cancel:'已安排取消续费',canceled:'已取消',currentPeriodEnds:'当前周期结束',nextPayment:'下次付款',manage:'管理 / 取消续费',portalError:'暂时无法打开客户门户，请刷新或联系支持。',trialHelp:'符合资格的验证账户自动获得一次 10 试用点，受活动预算限制。',trialBudget:'试用活动预算暂不可用，仍可使用已购买点数。',trialVerification:'验证账户后即可核验一次性试用点资格。',retryTrial:'重试试用点发放',renewalNote:'在客户门户取消将停止后续续费，已到账点数保留。'},
 'zh-Hant':{subscribe:'訂閱 · US$5 / 月',subscribeTest:'測試月付訂閱 · US$5 / 月',monthlyLive:'按月自動續費。適用稅費與最終總額以 Creem 結帳頁為準。',subscriptions:'月付訂閱',noSubscriptions:'還沒有月付訂閱。',subscriptionUnknown:'請重新整理核對既有訂閱，再開通月付方案。',subscriptionExists:'已有月付訂閱或待確認結帳。可在下方管理，或重新整理核對狀態。',subscriptionStatus:'狀態',active:'生效中',trialing:'試用期',past_due:'付款逾期',unpaid:'尚未付款',paused:'已暫停',scheduled_cancel:'已安排取消續費',canceled:'已取消',currentPeriodEnds:'目前週期結束',nextPayment:'下次付款',manage:'管理 / 取消續費',portalError:'暫時無法開啟客戶入口，請重新整理或聯絡支援。',trialHelp:'符合資格的驗證帳戶自動獲得一次 10 試用點，受活動預算限制。',trialBudget:'試用活動預算暫不可用，仍可使用已購買點數。',trialVerification:'驗證帳戶後即可核驗一次性試用點資格。',retryTrial:'重試試用點發放',renewalNote:'在客戶入口取消將停止後續續費，已入帳點數保留。'},
 ja:{subscribe:'月額プラン · US$5 / 月',subscribeTest:'月額プランのテスト · US$5 / 月',monthlyLive:'毎月自動更新。適用税と最終金額は Creem 決済画面に表示します。',subscriptions:'月額プラン',noSubscriptions:'月額プランはありません。',subscriptionUnknown:'月額プランの開始前に、更新して契約状況を確認してください。',subscriptionExists:'月額プランまたは確認中の決済があります。下で管理するか、更新して状況を確認してください。',subscriptionStatus:'状態',active:'有効',trialing:'お試し期間',past_due:'支払期限超過',unpaid:'未払い',paused:'一時停止',scheduled_cancel:'更新停止予定',canceled:'解約済み',currentPeriodEnds:'現在の期間終了',nextPayment:'次回の支払い',manage:'管理 / 自動更新を解約',portalError:'カスタマーポータルを開けませんでした。更新するかサポートへお問い合わせください。',trialHelp:'認証済みの対象アカウントに、キャンペーン予算の範囲で 10 ポイントを 1 回自動付与します。',trialBudget:'お試し予算を利用できません。購入済みポイントは引き続き使えます。',trialVerification:'アカウントを認証すると、お試しポイントの利用資格を確認できます。',retryTrial:'お試し付与を再試行',renewalNote:'カスタマーポータルでの解約は次回以降の更新を停止し、付与済みポイントは残ります。'}
};
const checkoutRecoveryCopy={"en":{"expired":"Expired","resume":"Continue checkout","checkPayment":"Check payment","checkoutExpired":"This checkout has expired. Choose a new purchase to continue.","monthlyPaidOrders":"Monthly paid orders","oneTimePaidOrders":"One-time paid orders","activeSubscriptions":"Active subscriptions"},"zh-Hans":{"expired":"已过期","resume":"继续结账","checkPayment":"核对付款","checkoutExpired":"这次结账已过期，可重新选择购买。","monthlyPaidOrders":"月付实付订单","oneTimePaidOrders":"一次性实付订单","activeSubscriptions":"生效订阅"},"zh-Hant":{"expired":"已過期","resume":"繼續結帳","checkPayment":"核對付款","checkoutExpired":"這次結帳已過期，可重新選擇購買。","monthlyPaidOrders":"月付實付訂單","oneTimePaidOrders":"一次性實付訂單","activeSubscriptions":"生效訂閱"},"ja":{"expired":"期限切れ","resume":"決済を続ける","checkPayment":"支払いを確認","checkoutExpired":"この決済は期限切れです。新たに購入を選択できます。","monthlyPaidOrders":"月額の支払済み注文","oneTimePaidOrders":"1 回限りの支払済み注文","activeSubscriptions":"有効な定期契約"}};
export const billingLabels=locale=>({...copy[commerceLocale(locale)],...reportingCopy[commerceLocale(locale)],...subscriptionCopy[commerceLocale(locale)],...checkoutRecoveryCopy[commerceLocale(locale)]});
export function catalogAvailability(catalog,productKey){
 if(catalog?.enabled!==true)return 'disabled';
 const product=productKey&&catalog.products?.find(item=>item.key===productKey);
 if(productKey===monthlyKey&&!product)return 'unavailable';
 if(productKey&&Array.isArray(catalog.products)&&(!product||product.available===false))return 'unavailable';
 if(product?.available!==true&&catalog.available!==true)return 'unavailable';
 return catalog.mode==='test'?'test':catalog.mode==='live'?'live':'unavailable';
}
export function safeCheckoutUrl(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname==='creem.io'||u.hostname.endsWith('.creem.io'))?u.href:null;}catch{return null;}
}
export function safePortalUrl(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['creem.io','www.creem.io'].includes(u.hostname)&&u.pathname.startsWith('/my-orders/')?u.href:null;}catch{return null;}
}
const monthlyKey='reading_monthly_100';
const subscriptionBlocksPurchase=subscription=>!['canceled','cancelled'].includes(subscription?.status);
const unfinishedOrder=order=>['pending','creating','processing'].includes(order?.status)&&order.paymentVerified!==true;
const pendingMonthlyOrder=order=>order?.productKey===monthlyKey&&!['paid','completed','fulfilled','refunded','partially_refunded','cancelled','canceled','failed','expired'].includes(order.status);
const problem=(code,status=409)=>Object.assign(new Error(code),{code,status});
const ownerOf=session=>typeof session?.user?.id==='string'&&session.user.id?session.user.id:null;
const intentId=()=>globalThis.crypto?.randomUUID?.()||(()=>{throw problem('BILLING_BROWSER_UNAVAILABLE',503);})();

// The expected owner is captured from GET session, never supplied by a caller.
// Before accepting any private response, independently reconcile the cookie
// identity. A stale response can neither restore old rows nor return a checkout.
export function createBillingClient({fetcher=globalThis.fetch?.bind(globalThis),intentFactory=intentId,onChange=()=>{}}={}){
 let revision=0,sessionRevision=0,trialPending=null;
 const intents=new Map(),intentOrders=new Map(),checkoutPending=new Map();
 const state={session:null,catalog:null,account:null,entries:[],orders:[],subscriptions:null,trialIssue:null,pendingProducts:[],entriesCursor:null,ordersCursor:null,returnOrder:null,summary:null};
 const snapshot=()=>({...state,entries:[...state.entries],orders:[...state.orders],subscriptions:state.subscriptions&&[...state.subscriptions],pendingProducts:[...state.pendingProducts]});
 const emit=()=>onChange(snapshot());
 function adoptSession(next){
  const changed=ownerOf(state.session)!==ownerOf(next);
  state.session=next;
  if(changed){revision++;sessionRevision++;intents.clear();intentOrders.clear();checkoutPending.clear();trialPending=null;Object.assign(state,{account:null,entries:[],orders:[],subscriptions:null,trialIssue:null,pendingProducts:[],entriesCursor:null,ordersCursor:null,returnOrder:null,summary:null});}
  emit();return changed;
 }
 async function raw(path,{method='GET',body,headers={}}={}){
  const res=await fetcher(path,{method,credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let data;try{data=await res.json();}catch{throw problem('BILLING_INVALID_RESPONSE',502);}
  if(!res.ok)throw problem(typeof data?.error?.code==='string'?data.error.code:typeof data?.code==='string'?data.code:'BILLING_REQUEST_FAILED',res.status);
  return data;
 }
 async function refreshSession(){const ticket=++sessionRevision;const next=await raw('/api/auth/session');if(ticket===sessionRevision)adoptSession(next);return state.session;}
 async function protectedRequest(path,options={}){
  const owner=ownerOf(state.session),ticket=revision;if(!owner)throw problem('BILLING_SIGN_IN_REQUIRED',401);
  let result,error;try{result=await raw(path,{...options,headers:{...options.headers,'X-Reader-Owner':owner}});}catch(caught){error=caught;}
  // Invalidate the ability of an earlier, concurrently running session read to
  // adopt a response after this authoritative post-request identity check.
  ++sessionRevision;let next;
  try{next=await raw('/api/auth/session');}catch{if(ticket===revision){adoptSession({user:null});}throw problem('BILLING_SIGN_IN_REQUIRED',401);}
  if(ticket!==revision)throw problem('BILLING_ACCOUNT_CHANGED');
  if(ownerOf(next)!==owner){adoptSession(next);throw problem('BILLING_ACCOUNT_CHANGED');}
  state.session=next;
  if(error){if(error.status===401)adoptSession({user:null});throw error;}
  return result;
 }
 const pagePath=(kind,cursor)=>'/api/billing/'+kind+'?limit=20'+(cursor?'&cursor='+encodeURIComponent(cursor):'');
 async function loadPage(kind,{more=false}={}){
  const ticket=revision,cursor=more?state[kind+'Cursor']:null;
  if(more&&!cursor)return snapshot();
  const data=await protectedRequest(pagePath(kind,cursor));
  if(ticket!==revision)throw problem('BILLING_ACCOUNT_CHANGED');
  const list=Array.isArray(data?.[kind])?data[kind]:[];
  // A retry of the same cursor must not create duplicate statement lines.
  const rows=more?[...state[kind],...list]:list;const seen=new Set();
  state[kind]=rows.filter(row=>{if(!row||typeof row!=='object')return false;if(row.id&&seen.has(row.id))return false;if(row.id)seen.add(row.id);return true;});
  state[kind+'Cursor']=typeof data?.nextCursor==='string'?data.nextCursor:null;emit();return data;
 }
 async function claimTrial(){const ticket=revision,data=await protectedRequest('/api/billing/trial',{method:'POST',body:{}});if(ticket!==revision)throw problem('BILLING_ACCOUNT_CHANGED');state.account=data?.account||data;state.trialIssue=null;emit();return state.account;}
 function expireIntent(productKey,orderId){if(!intentOrders.has(productKey)||intentOrders.get(productKey)===orderId){intents.delete(productKey);intentOrders.delete(productKey);state.pendingProducts=state.pendingProducts.filter(key=>key!==productKey);}}
 const client={
  snapshot,adoptSession,refreshSession,
  authRequest:(path,body)=>{if(!/^\/api\/auth\/(?:code|password|verify|password\/setup|local|oauth)$/.test(path))throw problem('BILLING_INVALID_AUTH_REQUEST',400);return raw(path,{method:'POST',body});},
  async loadCatalog(){state.catalog=await raw('/api/billing/catalog');emit();return state.catalog;},
  async loadAccount(){const ticket=revision,data=await protectedRequest('/api/billing/account');if(ticket!==revision)throw problem('BILLING_ACCOUNT_CHANGED');state.account=data?.account||data;emit();return state.account;},
  loadEntries:options=>loadPage('entries',options),loadOrders:options=>loadPage('orders',options),
  claimTrial,
  async ensureTrial(){
   if(!state.account||state.account.trialGranted)return state.account;
   if(trialPending)return trialPending;
   const ticket=revision;
   const pending=claimTrial().catch(error=>{
    if(ticket!==revision||error.code==='BILLING_ACCOUNT_CHANGED'||error.status===401)throw error;
    // Trial admission cannot remove access to already purchased funds.
    state.trialIssue=error.code;emit();return state.account;
   });trialPending=pending;
   void pending.finally(()=>{if(trialPending===pending)trialPending=null;}).catch(()=>{});return pending;
  },
  async loadSubscriptions(){const ticket=revision,data=await protectedRequest('/api/billing/subscriptions');if(ticket!==revision)throw problem('BILLING_ACCOUNT_CHANGED');if(!Array.isArray(data?.subscriptions))throw problem('BILLING_INVALID_RESPONSE',502);state.subscriptions=data.subscriptions;emit();return state.subscriptions;},
  checkout(productKey='reading_100'){
   if(!['reading_100',monthlyKey].includes(productKey))return Promise.reject(problem('BILLING_INVALID_PRODUCT',400));
   if(checkoutPending.has(productKey))return checkoutPending.get(productKey);
   if(productKey===monthlyKey&&(state.subscriptions===null||state.subscriptions.some(subscriptionBlocksPurchase)||state.orders.some(pendingMonthlyOrder)||state.pendingProducts.includes(monthlyKey)))return Promise.reject(problem('BILLING_SUBSCRIPTION_EXISTS'));
   if(!intents.has(productKey))intents.set(productKey,intentFactory());const ticket=revision;
   const pending=protectedRequest('/api/billing/checkouts',{method:'POST',body:{productKey,intentKey:intents.get(productKey)}}).then(data=>{
    if(ticket!==revision)throw problem('BILLING_ACCOUNT_CHANGED');const url=safeCheckoutUrl(data?.checkoutUrl);if(!url)throw problem('BILLING_INVALID_CHECKOUT',502);if(data?.order?.id)intentOrders.set(productKey,data.order.id);state.pendingProducts=[...new Set([...state.pendingProducts,productKey])];emit();return {...data,checkoutUrl:url};
   }).catch(error=>{if(ticket===revision&&error.code==='checkout_expired'){expireIntent(productKey,intentOrders.get(productKey));emit();}throw error;});checkoutPending.set(productKey,pending);
   void pending.finally(()=>{if(checkoutPending.get(productKey)===pending)checkoutPending.delete(productKey);}).catch(()=>{});return pending;
  },
  async portal(subscriptionId){
   if(typeof subscriptionId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(subscriptionId))throw problem('BILLING_INVALID_SUBSCRIPTION',400);
   const ticket=revision,data=await protectedRequest('/api/billing/portal',{method:'POST',body:{subscriptionId}});if(ticket!==revision)throw problem('BILLING_ACCOUNT_CHANGED');const portalUrl=safePortalUrl(data?.portalUrl);if(!portalUrl)throw problem('BILLING_INVALID_PORTAL',502);return {...data,portalUrl};
  },
  async pollOrder(id){
   if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(id))throw problem('BILLING_INVALID_ORDER',400);
   const ticket=revision,data=await protectedRequest('/api/billing/orders/'+encodeURIComponent(id)+'?reconcile=1');if(ticket!==revision)throw problem('BILLING_ACCOUNT_CHANGED');state.returnOrder=data?.order||data;if(state.returnOrder?.status==='expired')expireIntent(state.returnOrder.productKey,id);state.orders=state.orders.map(order=>order.id===id?state.returnOrder:order);emit();return state.returnOrder;
  },
  async recheckOrder(id){const ticket=revision,check=()=>{if(ticket!==revision)throw problem('BILLING_ACCOUNT_CHANGED');};const order=await client.pollOrder(id);check();await client.loadAccount();check();await client.loadOrders();check();await client.loadSubscriptions();check();return order;},
  async resumeCheckout(id){const ticket=revision,order=await client.recheckOrder(id);if(ticket!==revision)throw problem('BILLING_ACCOUNT_CHANGED');if(!unfinishedOrder(order))throw problem(order?.status==='expired'?'checkout_expired':'BILLING_CHECKOUT_NOT_PENDING');const checkoutUrl=safeCheckoutUrl(order.checkoutUrl);if(!checkoutUrl)throw problem('BILLING_INVALID_CHECKOUT',502);return {...order,checkoutUrl};},
  async loadSummary({from,to}){const a=Date.parse(from),b=Date.parse(to);if(!Number.isFinite(a)||!Number.isFinite(b)||a>=b)throw problem('BILLING_INVALID_RANGE',400);const ticket=revision,data=await protectedRequest('/api/admin/billing/summary?from='+encodeURIComponent(new Date(a).toISOString())+'&to='+encodeURIComponent(new Date(b).toISOString()));if(ticket!==revision)throw problem('BILLING_ACCOUNT_CHANGED');state.summary=data?.summary||data;emit();return state.summary;}
 };return client;
}

const validNumber=value=>Number.isFinite(value)&&Number.isSafeInteger(value);
export function formatReadingPoints(units,locale='en'){return validNumber(units)?new Intl.NumberFormat(commerceLocale(locale),{maximumFractionDigits:6}).format(units/1000000):'—';}
const count=value=>validNumber(value)&&value>=0?String(value):'—';
function money(amount,currency,locale='en'){
 if(!validNumber(amount)||!/^[A-Z]{3}$/.test(currency||''))return '—';
 try{const digits=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits;return new Intl.NumberFormat(commerceLocale(locale),{style:'currency',currency,currencyDisplay:'code'}).format(amount/10**digits);}catch{return '—';}
}
function dateTime(value,locale){const date=new Date(value);return value&&Number.isFinite(+date)?date.toLocaleString(commerceLocale(locale),{timeZoneName:'short'}):'—';}
const cell=value=>`<td>${escape(value)}</td>`;
const stat=(label,value)=>`<div class="billing-stat"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`;
const notice=(text,kind='')=>`<p class="billing-notice ${escape(kind)}" role="status">${escape(text)}</p>`;
const availabilityText=(catalog,c,productKey)=>{const availability=catalogAvailability(catalog,productKey);return availability==='live'&&productKey===monthlyKey?c.monthlyLive:c[availability];};
const entryType=entry=>entry.type||entry.kind;
const sourceName=(source,c)=>({trial:c.trialSource,purchase:c.purchaseSource,review:c.reviewSource})[source]||source||c.unknown;
function entryName(entry,c){if(entryType(entry)==='grant')return entry.source==='trial'?c.trialGrant:entry.source==='purchase'?c.purchaseGrant:sourceName(entry.source,c);const key=({translation:'translation',dual_translation:'translation',reading_conversation:'conversation',conversation:'conversation',reading_chat:'conversation',chat:'conversation',annotation:'annotation',ai_annotation:'annotation'})[entry.action];return key?c[key]:c[entryType(entry)]||entryType(entry)||c.unknown;}
function entryState(entry,c){return entryType(entry)==='reverse'?c.reversal:c[entryType(entry)]||c.unknown;}
const entryUnits=entry=>['hold','release'].includes(entryType(entry))&&validNumber(entry.reservedUnits)?Math.abs(entry.reservedUnits):entry.units;
function orderState(order,c){const paid=order.paymentVerified===true?c.paid:c.pending;return ({paid,completed:paid,fulfilled:paid,refunded:c.refund,partially_refunded:c.refund,disputed:c.disputed,cancelled:c.cancelled,canceled:c.cancelled,expired:c.expired,failed:c.failed})[order.status]||c.pending;}
function table(title,headers,rows,empty){return `<section class="billing-section"><h2>${escape(title)}</h2>${rows.length?`<div class="table-scroll" tabindex="0" role="region" aria-label="${escape(title)}"><table><caption class="sr-only">${escape(title)}</caption><thead><tr>${headers.map(value=>`<th scope="col">${escape(value)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`:`<p class="billing-empty">${escape(empty)}</p>`}</section>`;}
function renderAccountSources(account,locale,c){
 const rows=Array.isArray(account?.sources)?account.sources.map(source=>`<tr><th scope="row">${escape(sourceName(source.source,c))}</th>${cell(formatReadingPoints(source.availableUnits,locale))}${cell(formatReadingPoints(source.reservedUnits,locale))}</tr>`):[];
 return rows.length?table(c.sources,[c.category,c.available,c.reserved],rows,c.unknown):`<p>${c.unknown}</p>`;
}
function renderSubscriptions(subscriptions,locale,c){
 const rows=subscriptions?.map(subscription=>{
  const id=subscription.id||subscription.subscriptionId,status=subscription.status;
  const next=subscription.nextTransactionDate,periodEnd=subscription.currentPeriodEnd||subscription.periodEnd;
  return `<article class="billing-subscription"><h3>${escape(c[status]||c.unknown)}</h3>${id?`<p class="billing-reference">${escape(id)}</p>`:''}<dl>${next?`<div><dt>${c.nextPayment}</dt><dd>${escape(dateTime(next,locale))}</dd></div>`:periodEnd?`<div><dt>${c.currentPeriodEnds}</dt><dd>${escape(dateTime(periodEnd,locale))}</dd></div>`:''}</dl>${id?`<button class="outline" type="button" data-billing-action="portal" data-subscription-id="${escape(id)}">${c.manage} ↗</button>`:''}</article>`;
 })||[];
 return `<section class="billing-section billing-subscriptions" aria-labelledby="subscription-title"><h2 id="subscription-title">${c.subscriptions}</h2>${subscriptions===null?notice(c.subscriptionUnknown):rows.length?rows.join(''):`<p class="fine-print">${c.noSubscriptions}</p>`}<p class="fine-print">${c.renewalNote}</p></section>`;
}
export function renderBillingAccount({locale='en',session,catalog,account,entries=[],orders=[],subscriptions=null,pendingProducts=[],trialIssue,entriesCursor,ordersCursor,returnOrder}={}){
 locale=commerceLocale(locale);const c=billingLabels(locale),commerce=commerceCopy(locale);
 if(!ownerOf(session))return `<section class="billing-signin"><h2>${c.signIn}</h2><p>${c.signInBody}</p><button class="primary" type="button" data-billing-action="signin">${c.signIn}</button></section>${notice(availabilityText(catalog,c))}`;
 const rows=entries.map(entry=>`<tr>${cell(dateTime(entry.createdAt||entry.at,locale))}${cell(entryName(entry,c))}${cell(formatReadingPoints(entryUnits(entry),locale))}${cell(entryState(entry,c))}<td class="billing-reference">${escape(entry.operationId||entry.orderId||entry.id||'—')}</td></tr>`);
 const orderRows=orders.map(order=>{const receipt=safeCheckoutUrl(order.receiptUrl||order.receipt?.url);return `<tr><td class="billing-reference">${escape(order.id||'—')}</td>${cell(dateTime(order.createdAt,locale))}${cell(money(order.paidAmount??order.amount,order.currency,locale))}${cell(money(order.refundedAmount,order.currency,locale))}${cell(formatReadingPoints(order.units,locale))}${cell(orderState(order,c))}<td>${receipt?`<a href="${escape(receipt)}" target="_blank" rel="noopener noreferrer">${c.receipt} ↗</a>`:'—'}${unfinishedOrder(order)?`<div class="billing-order-actions">${safeCheckoutUrl(order.checkoutUrl)?`<button class="outline" type="button" data-billing-action="resume" data-order-id="${escape(order.id)}">${c.resume}</button>`:''}<button class="outline" type="button" data-billing-action="recheck" data-order-id="${escape(order.id)}">${c.checkPayment}</button></div>`:''}</td></tr>`;});
 const monthlyBlocked=subscriptions===null||subscriptions.some(subscriptionBlocksPurchase)||orders.some(pendingMonthlyOrder)||pendingProducts.includes(monthlyKey);
 const purchase=(productKey,title,price,body)=>{
  const monthly=productKey===monthlyKey,availability=catalogAvailability(catalog,productKey),blocked=monthly&&monthlyBlocked;
  return `<section class="billing-purchase" aria-labelledby="${productKey}-title"><div><h2 id="${productKey}-title">${escape(title)}</h2><p class="purchase-price">${escape(price)}</p><p>${commerce.pack}</p><p class="fine-print">${escape(body)}</p></div><div>${notice(availabilityText(catalog,c,productKey),availability==='test'?'test-mode':'')}<button class="primary" type="button" data-billing-action="checkout" data-product-key="${productKey}"${!['live','test'].includes(availability)||account?.frozen||blocked?' disabled':''}>${monthly?availability==='test'?c.subscribeTest:c.subscribe:availability==='test'?c.buyTest:c.buy}</button>${blocked&&subscriptions!==null?notice(c.subscriptionExists):''}</div></section>`;
 };
 const trialNotice=trialIssue?notice(trialIssue==='trial_budget_exhausted'?c.trialBudget:trialIssue==='verified_account_required'?c.trialVerification:c.trialError):'';
 return `${account?.frozen?notice(c.frozen,'warning'):''}<section class="balance-strip" aria-label="${c.title}">${stat(c.available,formatReadingPoints(account?.availableUnits,locale))}${stat(c.reserved,formatReadingPoints(account?.reservedUnits,locale))}${stat(c.consumed,formatReadingPoints(account?.consumedUnits,locale))}</section><p class="fine-print">${c.unitsNote}</p>${trialNotice}<div class="billing-products">${purchase('reading_100',commerce.topUp,'US$5',commerce.once)}${purchase(monthlyKey,commerce.monthly,commerce.monthlyPrice,commerce.monthlyBody)}</div><p class="fine-print">${commerce.tax}</p><p class="fine-print">${commerce.accumulation}</p><p class="fine-print"><a href="${commercePath('pricing',locale)}">${commerce.pricing}</a> · <a href="${commercePath('terms',locale)}">${commerce.terms}</a> · <a href="${commercePath('refunds',locale)}">${commerce.refunds}</a></p>${renderSubscriptions(subscriptions,locale,c)}<details class="billing-sources"><summary>${c.sources}</summary>${renderAccountSources(account,locale,c)}<p>${c.granted}: ${formatReadingPoints(account?.grantedUnits,locale)} · ${c.consumed}: ${formatReadingPoints(account?.consumedUnits,locale)}</p>${account?.trialGranted?`<p>${c.trialYes}</p>`:`<p class="fine-print">${c.trialHelp}</p><button class="outline" type="button" data-billing-action="trial">${c.retryTrial}</button>`}</details>${returnOrder?notice(orderState(returnOrder,c),'return-order'):''}${table(c.entries,[c.date,c.feature,c.points,c.state,c.reference],rows,c.emptyEntries)}${entriesCursor?`<button class="outline" type="button" data-billing-action="entries">${c.more}</button>`:''}${table(c.orders,[c.order,c.date,c.amount,c.refunds,c.points,c.state,c.receipt],orderRows,c.emptyOrders)}${ordersCursor?`<button class="outline" type="button" data-billing-action="orders">${c.more}</button>`:''}<p class="fine-print">${c.free}</p>`;
}
function currencyList(values,locale,c){
 if(!values||typeof values!=='object'||!Object.keys(values).length)return `<p class="billing-empty">${c.emptyCurrency}</p>`;
 return `<dl class="currency-list">${Object.entries(values).filter(([currency])=>/^[A-Z]{3}$/.test(currency)).map(([currency,value])=>`<div><dt>${escape(currency)}</dt><dd>${escape(money(typeof value==='number'?value:value?.amount,currency,locale))}</dd></div>`).join('')}</dl>`;
}
function groupedCalls(title,groups,locale,c,funding=false){
 const name=key=>funding?({sponsor:c.sponsored,sponsored:c.sponsored,credits:c.userFunded,legacy_operator_funded:c.operatorFunded,operator:c.operatorFunded})[key]||key:({translation:c.translation,conversation:c.conversation,annotation:c.annotation})[key]||key;
 const rows=groups&&typeof groups==='object'?Object.entries(groups).map(([key,value])=>`<tr><th scope="row">${escape(name(key))}</th>${cell(count(value?.calls))}${cell(validNumber(value?.knownCostMicrousd)?(value.knownCostMicrousd/1000000).toFixed(6):c.unknown)}${cell(count(value?.unknownCostCalls))}</tr>`):[];
 return table(title,[c.category,c.calls,c.known,c.unknownCalls],rows,c.unknown);
}
function sourceSummary(summary,locale,c){
 const keys=[...new Set([...Object.keys(summary.grantedUnitsBySource||{}),...Object.keys(summary.consumedUnitsBySource||{})])];
 return table(c.sourceTitle,[c.category,c.granted,c.consumed],keys.map(key=>`<tr><th scope="row">${escape(sourceName(key,c))}</th>${cell(formatReadingPoints(summary.grantedUnitsBySource?.[key],locale))}${cell(formatReadingPoints(summary.consumedUnitsBySource?.[key],locale))}</tr>`),c.unknown);
}
function operationSummary(summary,c){
 return table(c.operations,[c.state,c.calls],Object.entries(summary.operationCounts||{}).map(([key,value])=>`<tr><th scope="row">${escape(({reserved:c.reservedState,failed:c.failed,cancelled:c.cancelled})[key]||c[key]||key)}</th>${cell(count(value))}</tr>`),c.unknown);
}
export function renderBillingAdmin({locale='en',summary,from,to}={}){
 const c=billingLabels(locale);if(!summary)return notice(c.noSummary);
 return `<p class="fine-print">${c.range}</p><p class="billing-range"><strong>${c.report}</strong> <time>${escape(from)}</time> → <time>${escape(to)}</time></p><section class="balance-strip" aria-label="${c.admin}">${stat(c.accounts,count(summary.accounts))}${stat(c.paidOrders,count(summary.paidOrders))}${stat(c.monthlyPaidOrders,count(summary.monthlyPaidOrders))}${stat(c.oneTimePaidOrders,count(summary.oneTimePaidOrders))}${stat(c.activeSubscriptions,count(summary.activeSubscriptions))}${stat(c.paidUsers,count(summary.paidUsers))}${stat(c.calls,count(summary.calls))}</section><div class="billing-report-grid"><section><h2>${c.sales}</h2>${currencyList(summary.salesByCurrency,locale,c)}</section><section><h2>${c.refunds}</h2>${currencyList(summary.refundsByCurrency,locale,c)}</section></div><section class="balance-strip" aria-label="${c.points}">${stat(c.granted,formatReadingPoints(summary.grantedUnits,locale))}${stat(c.consumed,formatReadingPoints(summary.consumedUnits,locale))}${stat(c.reserved,formatReadingPoints(summary.reservedUnits,locale))}</section><section class="billing-section"><h2>${c.knownCost}</h2><p class="known-cost">${validNumber(summary.knownCostMicrousd)?'USD '+(summary.knownCostMicrousd/1000000).toFixed(6):c.unknown}</p><p>${count(summary.unknownCostCalls)} ${c.unknownCost}</p><p class="fine-print">${c.costNote}</p><p>${c.fees}: ${c.unknown}</p></section>${groupedCalls(c.fundingTitle,summary.callsByFunding,locale,c,true)}${groupedCalls(c.featureTitle,summary.callsByFeature,locale,c)}${sourceSummary(summary,locale,c)}<p class="fine-print">${c.trialGrants}: ${count(summary.trialGrants)} · ${c.reviewOrders}: ${count(summary.reviewOrders)}</p>${operationSummary(summary,c)}`;
}

// Date inputs use one explicit reporting zone, never the browser's local zone.
export function billingDateRange(from,to){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(to||''))throw problem('BILLING_INVALID_RANGE',400);
 const a=new Date(from+'T00:00:00+08:00'),b=new Date(to+'T00:00:00+08:00');
 const actual=date=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
 if(!Number.isFinite(+a)||!Number.isFinite(+b)||actual(a)!==from||actual(b)!==to||+a>=+b)throw problem('BILLING_INVALID_RANGE',400);
 return {from:a.toISOString(),to:b.toISOString()};
}

async function mountBilling(document){
 const root=document.getElementById('billing-content');if(!root)return;
 const params=new URLSearchParams(location.search),locale=commerceLocale(params.get('ui')||document.documentElement.lang),c=billingLabels(locale),admin=location.pathname==='/admin/billing';
 document.documentElement.lang=locale;document.title=(admin?c.admin:c.title)+' · Leafhour';
 const $=id=>document.getElementById(id);$('billing-title').textContent=admin?c.admin:c.title;$('billing-back').textContent=c.back;$('billing-back').href='/library?ui='+locale;$('billing-refresh').textContent=c.retry;
 $('billing-policy-links').innerHTML=['pricing','terms','refunds'].map(kind=>`<a href="${commercePath(kind,locale)}">${commerceCopy(locale)[kind]}</a>`).join('')+`<a href="/${({'en':'en','zh-Hans':'zh-hans','zh-Hant':'zh-hant','ja':'ja'})[locale]}/privacy">${c.privacy}</a><a href="mailto:support@leafhour.com">support@leafhour.com</a>`;
 let busy=false,auth=null,disposed=false,pollTimer=null,returnOwner=null,returnGeneration=0,range=null,restoreAction=null;
 const render=()=>{
  if(disposed)return;
  const focused=document.activeElement?.closest?.('[data-billing-action]');if(focused&&root.contains(focused))restoreAction={action:focused.dataset.billingAction,product:focused.dataset.productKey,subscription:focused.dataset.subscriptionId,order:focused.dataset.orderId};
  const sourcesOpen=root.querySelector('.billing-sources')?.open;
  const state=client.snapshot();root.innerHTML=admin&&ownerOf(state.session)?renderBillingAdmin({locale,...state,...range}):renderBillingAccount({locale,...state});
  if(sourcesOpen&&root.querySelector('.billing-sources'))root.querySelector('.billing-sources').open=true;
  root.setAttribute('aria-busy',String(busy));for(const button of root.querySelectorAll('button'))button.disabled||=busy;$('billing-refresh').disabled=busy;
  if(!busy&&restoreAction&&!document.querySelector('dialog[open]')){const target=[...root.querySelectorAll('[data-billing-action]')].find(button=>button.dataset.billingAction===restoreAction.action&&button.dataset.productKey===restoreAction.product&&button.dataset.subscriptionId===restoreAction.subscription&&button.dataset.orderId===restoreAction.order)||root.querySelector('.billing-sources summary')||$('billing-refresh');if(!target.disabled)target.focus({preventScroll:true});restoreAction=null;}
 };
 const client=createBillingClient({onChange:render});
 const setStatus=(text,error=false)=>{$('billing-status').textContent=text;$('billing-status').setAttribute('role',error?'alert':'status');};
 const errorText=(error,fallback='error')=>error?.code==='BILLING_ACCOUNT_CHANGED'?c.changed:error?.code==='checkout_expired'?c.checkoutExpired:error?.code==='BILLING_SUBSCRIPTION_EXISTS'?c.subscriptionExists:error?.status===401?c.signInRequired:error?.status===403&&admin?c.forbidden:c[fallback];
 function stopPolling(){returnGeneration++;clearTimeout(pollTimer);pollTimer=null;}
 async function loadPrivate(){if(!ownerOf(client.snapshot().session))return;if(admin){range||=billingDateRange($('billing-from').value,$('billing-to').value);await client.loadSummary(range);}else{await client.loadAccount();await client.ensureTrial();await client.loadEntries();await client.loadOrders();await client.loadSubscriptions();}}
 async function refresh(){if(busy)return;busy=true;stopPolling();render();setStatus(c.loading);try{await client.refreshSession();if(!returnOwner&&params.get('order'))returnOwner=ownerOf(client.snapshot().session);await client.loadCatalog();await loadPrivate();setStatus('');if(!admin)void beginPolling();}catch(error){setStatus(errorText(error),true);}finally{busy=false;render();}}
 async function ensureAuth(){
  if(!auth){const {mountAuthDialog}=await import('./auth-dialog.mjs');auth=mountAuthDialog({dialog:$('auth-dialog'),api:client.authRequest,getSession:()=>client.snapshot().session,getReturnTo:()=>location.pathname+location.search,onAuthenticated:refresh,onSessionSettled:refresh});$('billing-auth-close').addEventListener('click',()=>auth.close());}
  auth.open();
 }
 async function beginPolling(){
  const order=params.get('order');const owner=ownerOf(client.snapshot().session);if(!order||!owner||admin)return;
  // A return URL is untrusted and contains no verified owner. Bind it once to
  // the first signed-in identity and never poll it under a switched account.
  if(returnOwner&&returnOwner!==owner)return;returnOwner=owner;
  const generation=++returnGeneration;let attempts=0;
  const next=async()=>{
   if(disposed||generation!==returnGeneration||document.hidden||ownerOf(client.snapshot().session)!==owner)return;
   try{setStatus(c.checking);const result=await client.pollOrder(order);if(generation!==returnGeneration||ownerOf(client.snapshot().session)!==owner)return;setStatus(orderState(result,c));if(['paid','completed','fulfilled','refunded','partially_refunded','disputed','cancelled','expired','failed'].includes(result.status)){await client.loadAccount();await client.loadOrders();await client.loadSubscriptions();return;}if(++attempts<12)pollTimer=setTimeout(next,2500);}
   catch(error){setStatus(errorText(error),true);stopPolling();}
  };await next();
 }
 async function act(event){
  const button=event.target.closest('[data-billing-action]');if(!button||busy)return;const action=button.dataset.billingAction;if(action==='signin'){await ensureAuth();return;}
  busy=true;render();setStatus('');
  try{if(action==='checkout'){const result=await client.checkout(button.dataset.productKey);location.assign(result.checkoutUrl);}else if(action==='portal'){const result=await client.portal(button.dataset.subscriptionId);location.assign(result.portalUrl);}else if(action==='resume'){const result=await client.resumeCheckout(button.dataset.orderId);location.assign(result.checkoutUrl);}else if(action==='recheck'){const result=await client.recheckOrder(button.dataset.orderId);setStatus(orderState(result,c));}else if(action==='trial'){await client.claimTrial();await client.loadEntries();}else if(action==='entries')await client.loadEntries({more:true});else if(action==='orders')await client.loadOrders({more:true});}
  catch(error){setStatus(errorText(error,['checkout','resume'].includes(action)?'checkoutError':action==='portal'?'portalError':action==='trial'?'trialError':'error'),true);}finally{busy=false;render();}
 }
 root.addEventListener('click',event=>{void act(event);});$('billing-refresh').addEventListener('click',()=>{void refresh();});
 const form=$('billing-range-form');form.hidden=!admin;
 if(admin){$('billing-from-label').textContent=c.from;$('billing-to-label').textContent=c.to;$('billing-range-submit').textContent=c.apply;$('billing-range-help').textContent=c.range;const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());$('billing-to').value=today;const from=new Date(today+'T00:00:00+08:00');from.setUTCDate(from.getUTCDate()-30);$('billing-from').value=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(from);
  form.addEventListener('submit',event=>{event.preventDefault();try{range=billingDateRange($('billing-from').value,$('billing-to').value);void refresh();}catch{setStatus(c.timeError,true);}});
 }
 const checkIdentity=async()=>{if(disposed||document.hidden||busy||auth?.hasPendingSessionChange())return;const before=ownerOf(client.snapshot().session);try{await client.refreshSession();if(before!==ownerOf(client.snapshot().session)){stopPolling();auth?.reset();setStatus(c.changed,true);}}catch{client.adoptSession({user:null});stopPolling();setStatus(c.signInRequired,true);}};
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPolling();else void checkIdentity();});window.addEventListener('focus',()=>{void checkIdentity();});
 const identityTimer=setInterval(()=>{void checkIdentity();},30000);
 window.addEventListener('pagehide',()=>{disposed=true;clearInterval(identityTimer);stopPolling();auth?.dispose();},{once:true});
 void refresh();
}
if(typeof document!=='undefined'){
 if(document.getElementById('billing-content'))void mountBilling(document);
 const publicStatuses=[...document.querySelectorAll('[data-billing-public]')];
 if(publicStatuses.length){fetch('/api/billing/catalog',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}}).then(async response=>{if(!response.ok)throw Error('unavailable');const catalog=await response.json();for(const status of publicStatuses)status.textContent=availabilityText(catalog,billingLabels(status.dataset.locale),status.dataset.productKey);}).catch(()=>{for(const status of publicStatuses)status.textContent=billingLabels(status.dataset.locale).unavailable;});}
}
