import {journalMonthSummary,journalDayLevel,buildReadingJournalShare,paintReadingJournalShare,prepareReadingJournalShare} from './reading-journal.mjs';
import {trackActionFocus} from './action-focus.mjs';
import {READING_TIME_SOURCES,readingTimeSourceLabel,READING_TIME_SOURCE_IDS,READING_TIME_MEANING_ID} from './reading-time-policy.mjs';
import {t,getUiLocale,uiHref,onUiLocaleChange,uiReady} from './ui-locale.mjs';
const timeLabels=()=>Object.fromEntries([...Object.entries(READING_TIME_SOURCE_IDS).map(([key,id])=>[key,t(id)])]);
const timeSourceLabel=value=>readingTimeSourceLabel(value,timeLabels());
import {inferSourceLanguage} from './source-language.mjs';
import {paintBookCover} from './book-binding.mjs';
import {mountReadingArrival} from './reading-arrival.mjs';
import {calendarMonth,shiftReadingMonth,createCalendarRequestState,localReadingDate,readingTimeLabel} from './reading-calendar.mjs';
import {readingBookUrl,readingWeek,latestReadingEntry,workspaceCurrentBook,loadWorkspaceActivity,roomQuestionUrl} from './library-workspace.mjs';
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const button=(text,label)=>{const b=node('button','',text);b.type='button';if(label)b.setAttribute('aria-label',label);return b;};
export function mountReadingDashboard({root,overviewRoot,historyRoot,api,getSession,getBooks,getOwner,openAuth,refresh,onCurrentBook=()=>{},onOverlay=()=>{},onClose=()=>{}}){
  // Per-mount owned label registry: language commits reformat these nodes from
  // the cached view only. They never call renderToday/renderCalendar/
  // renderOverview/load/loadPreview/getBooks/refresh and never touch request,
  // focus, preview, calendar selection or arrival lifecycle state.
  const labels=new Map(),links=new Set();
  const specText=spec=>typeof spec.render==='function'?spec.render():t(spec.id,spec.params);
  const apply=(n,spec)=>{const value=specText(spec);if(spec.attr)n.setAttribute(spec.attr,value);else n.textContent=value;return n;};
  const own=(n,spec)=>{labels.set(n,spec);apply(n,spec);return n;};
  const ui=(tag,cls,id,params)=>own(node(tag,cls),{id,params});
  const attr=(n,attrName,id,params)=>own(n,{attr:attrName,id,params});
  const ownedLink=(n,target)=>{n.href=uiHref(target);n.setAttribute('data-ui-owned-href',target);links.add(n);return n;};
  const num=value=>new Intl.NumberFormat(getUiLocale()).format(value);
  const duration=seconds=>readingTimeLabel(seconds,()=>seconds<60?seconds>0?t('unit.timeLess'):t('unit.timeZero'):t('unit.minutes',{minutes:num(Math.floor(seconds/60))}));
  const monthHeading=()=>new Intl.DateTimeFormat(getUiLocale(),{year:'numeric',month:'long',timeZone:'UTC'}).format(new Date(month+'-01T12:00:00Z'));
  const dayHeading=()=>new Intl.DateTimeFormat(getUiLocale(),{month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(selectedDate+'T12:00:00Z'));
  const weekday=date=>new Intl.DateTimeFormat(getUiLocale(),{weekday:'narrow',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
  const zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',today=()=>localReadingDate(zone),requests=createCalendarRequestState();let month=today().slice(0,7),selectedDate=today(),selectedBook=null,busy=false,overviewData=null,disposed=false;
  let todayBook=null,calendarSignedIn=false,writeMessage=null;
  const todayPanel=node('section','today-panel'),copy=node('div','today-copy'),label=node('p','today-label'),title=node('h2'),author=node('p','today-author'),description=node('p','today-description'),progress=node('p','today-progress'),choice=node('select','today-book-choice');
  const actions=node('div','today-actions'),read=node('a','primary'),goalLabel=node('label','reading-goal'),goal=node('select');
  for(const minutes of [5,10,15,20,25,30,45,60,90,120]){const o=own(node('option'),{render:()=>t('unit.minutes',{minutes:num(minutes)})});o.value=minutes;goal.append(o);}
  const mark=button('');mark.className='text-link';
  const options=node('details','book-reading-options'),optionsLabel=ui('summary','','dash.options.label'),optionsBody=node('div','book-reading-options-body');const writeStatus=node('p','reading-write-status');writeStatus.setAttribute('role','status');optionsBody.append(choice,progress,goalLabel,mark,writeStatus);options.append(optionsLabel,optionsBody);actions.append(read,options);
  goalLabel.append(own(node('span'),{id:'dash.goal.label'}),goal);
  const textHead=node('div','today-heading');textHead.append(label,title,author,description);
  const excerpt=node('blockquote','room-excerpt'),excerptHeader=node('div','room-excerpt-header'),excerptLabel=node('span','room-excerpt-label'),excerptToggle=button(''),excerptText=node('p','room-excerpt-text'),excerptError=node('p','room-excerpt-error'),excerptRetry=button('');excerptToggle.className='room-excerpt-toggle';excerptRetry.className='room-excerpt-retry';own(excerptRetry,{id:'dash.excerpt.retry'});excerptHeader.append(excerptLabel,excerptToggle);excerpt.append(excerptHeader,excerptText,excerptError,excerptRetry);
  const questionSlip=node('aside','room-question'),questionLabel=ui('p','room-question-label','dash.question.label'),questionText=node('p','room-question-text'),questionLink=ui('a','room-question-link','dash.question.link');questionSlip.hidden=true;questionSlip.append(questionLabel,questionText,questionLink);copy.append(textHead,excerpt,actions,questionSlip);const illustration=node('div','continue-cover');illustration.setAttribute('aria-hidden','true');todayPanel.append(illustration,copy);
  let previewSequence=0,previewKey=null,preview=null,showOriginal=false;
  function renderQuestion(){
    const question=getSession()?.user?preview?.question:null;
    questionSlip.hidden=!question;questionText.textContent=question?.text||'';
    if(question)ownedLink(questionLink,roomQuestionUrl(activeBook(),question));else questionLink.removeAttribute('href');
  }
  function renderPreview(){
    renderQuestion();
    const variant=activeBook()?.resume?.variant||'interpretive',translated=preview?.[variant];
    excerptToggle.hidden=!preview;excerptText.hidden=!preview;excerptError.hidden=!!preview;excerptRetry.hidden=!!preview;
    if(!preview)return;
    const original=showOriginal||!translated;excerpt.lang=original?inferSourceLanguage(preview.original):'zh';
    excerptText.textContent=original?preview.original:translated;
    excerptToggle.disabled=!translated;
    own(excerptToggle,{render:()=>!translated?t('dash.excerpt.toggleMissing'):original?t('dash.excerpt.toggleTranslation'):t('dash.excerpt.toggleOriginal')});
    excerptToggle.setAttribute('aria-pressed',String(original));
    own(excerptLabel,{render:()=>original?(translated?t('dash.excerpt.label.original'):t(variant==='literal'?'dash.excerpt.noLiteral':'dash.excerpt.noInterpretive')):t(variant==='literal'?'dash.excerpt.label.literal':'dash.excerpt.label.interpretive')+(preview?.translationStatus?.[variant]==='draft'?t('dash.draftSuffix'):'')});
  }
  async function loadPreview(force=false){
    const book=activeBook(),owner=getOwner(),key=book?owner+'|'+book.bookId+'|'+(book.resume?.passageId||'')+'|'+book.contentVersion:null;if(!force&&key===previewKey)return;previewKey=key;const sequence=++previewSequence;preview=null;excerpt.hidden=!book;if(!book){renderPreview();return;}showOriginal=book.resume?.mode==='en';
    own(excerptError,{id:'dash.excerpt.loading'});renderPreview();excerptRetry.hidden=true;
    try{const data=await api('/api/library/books/'+encodeURIComponent(book.bookId)+'/preview'+(book.resume?.passageId?'?passageId='+encodeURIComponent(book.resume.passageId):''));if(disposed||sequence!==previewSequence||owner!==getOwner())return;preview=data;renderPreview();}
    catch(error){if(disposed||sequence!==previewSequence||owner!==getOwner())return;own(excerptError,{id:'dash.excerpt.failed'});renderPreview();}
  }
  excerptToggle.addEventListener('click',()=>{showOriginal=!showOriginal;renderPreview();});excerptRetry.addEventListener('click',async()=>{const focus=trackActionFocus(document,excerptRetry);await loadPreview(true);focus.restore(excerptRetry.hidden?excerptToggle.disabled?read:excerptToggle:excerptRetry);});
  const calendar=node('section','reading-calendar'),heading=node('div','calendar-heading'),intro=node('div');intro.append(ui('h2','','dash.calendar.title'),ui('p','muted','dash.calendar.intro'));const navigation=node('div','calendar-navigation'),prev=button('←'),next=button('→'),monthLabelNode=node('span'),thisMonth=button('');attr(prev,'aria-label','dash.calendar.prev');attr(next,'aria-label','dash.calendar.next');own(thisMonth,{id:'dash.calendar.current'});navigation.append(prev,monthLabelNode,next,thisMonth);heading.append(intro,navigation);
  const calendarStatus=node('p','calendar-status'),retry=button(''),login=button('');own(retry,{id:'dash.calendar.retry'});own(login,{id:'dash.calendar.signIn'});retry.className=login.className='outline small';const grid=node('div','calendar-grid');grid.setAttribute('role','group');
  const layout=node('div','calendar-layout'),left=node('div','calendar-main'),stats=node('div','calendar-stats'),sourceStats=node('p','reading-time-breakdown'),detail=node('aside','calendar-detail');detail.setAttribute('aria-live','polite');const monthMeasurement=node('details','journal-month-measurement');monthMeasurement.append(ui('summary','','journal.measurement'),sourceStats,ui('p','calendar-meaning',READING_TIME_MEANING_ID));left.append(calendarStatus,retry,login,grid,stats,monthMeasurement);layout.append(left,detail);calendar.append(heading,layout);const loading=root.querySelector('[data-reading-arrival]')||node('div');loading.dataset.readingArrival='library';const arrival=mountReadingArrival(loading),loadError=node('p','dashboard-loading');loadError.hidden=true;loadError.setAttribute('role','status');root.replaceChildren(loading,loadError,todayPanel);todayPanel.hidden=true;
  const closeHistory=button('×');closeHistory.className='dialog-close';attr(closeHistory,'aria-label','dash.calendar.close');closeHistory.addEventListener('click',()=>historyRoot.close());historyRoot.replaceChildren(closeHistory,calendar);historyRoot.addEventListener('close',()=>onClose('calendar'));
  const overviewTitle=ui('h2','','journal.title'),week=node('div','journal-month-grid'),overviewBody=node('div','reading-overview-body'),historyButton=ui('button','text-link','dash.overview.history'),overviewHeading=node('div','journal-heading'),overviewMonth=node('p','journal-month-label'),overviewSummary=node('div','journal-summary'),overviewTotal=node('p','journal-total'),overviewDays=node('p','journal-days'),overviewLegend=ui('p','journal-legend','journal.legend');
  overviewHeading.append(overviewTitle,historyButton);overviewSummary.append(overviewTotal,overviewDays);let overviewFocusDate=today();overviewRoot.classList.add('reading-journal');overviewRoot.hidden=false;overviewRoot.replaceChildren(overviewHeading,overviewMonth,overviewSummary,week,overviewBody,overviewLegend);root.after?.(overviewRoot);
  const sharePanel=node('section','journal-share-preview'),shareHeading=ui('h3','','journal.share.title'),shareHelp=ui('p','journal-share-help','journal.share.help'),shareToggleLabel=node('label','journal-share-toggle'),shareToggle=node('input'),shareToggleText=ui('span','','journal.share.books'),shareCanvas=node('canvas','journal-share-canvas'),shareActions=node('div','journal-share-actions'),shareSave=ui('button','primary','journal.share.save'),shareClose=ui('button','text-link','journal.share.close'),shareStatus=node('p','journal-share-status');
  sharePanel.hidden=true;shareToggle.type='checkbox';shareToggleLabel.append(shareToggle,shareToggleText);shareCanvas.setAttribute('role','img');shareStatus.setAttribute('role','status');shareActions.append(shareSave,shareClose);sharePanel.append(shareHeading,shareHelp,shareToggleLabel,shareCanvas,shareActions,shareStatus);calendar.append(sharePanel);let shareDay=null,shareOwner=null,shareBusy=false,shareOpener=null,shareRevision=0;
  function closeShare({restore=true}={}){shareRevision++;sharePanel.hidden=true;shareDay=null;shareOwner=null;shareToggle.checked=false;shareStatus.textContent='';shareSave.disabled=false;shareBusy=false;const context=shareCanvas.getContext?.('2d');context?.clearRect(0,0,shareCanvas.width,shareCanvas.height);if(restore&&shareOpener?.isConnected)shareOpener.focus({preventScroll:true});shareOpener=null;}
  async function paintShare(){
    if(!shareDay||sharePanel.hidden)return;const revision=++shareRevision,model=buildReadingJournalShare(shareDay,{includeBookTitles:shareToggle.checked}),date=new Date(model.date+'T12:00:00Z'),dateLabel=new Intl.DateTimeFormat(getUiLocale(),{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'}).format(date),copy={locale:getUiLocale(),title:t('journal.share.imageTitle'),dateLabel,timeLabel:duration(model.durationSeconds),sourceLabels:Object.fromEntries(READING_TIME_SOURCES.map(source=>[source,value=>timeSourceLabel(source)+'  '+duration(value)])),bookLabel:t('journal.share.bookLabel'),returnLabel:t('journal.share.imageLine'),overlapLabel:t('journal.share.overlap')};
    shareBusy=true;shareSave.disabled=true;own(shareStatus,{id:'journal.share.preparing'});
    await prepareReadingJournalShare(document.fonts,model,copy);
    if(disposed||sharePanel.hidden||revision!==shareRevision)return;
    paintReadingJournalShare(shareCanvas,model,copy);shareBusy=false;shareSave.disabled=false;labels.delete(shareStatus);shareStatus.textContent='';shareCanvas.setAttribute('aria-label',t('journal.share.imageAria',{date:dateLabel,time:duration(model.durationSeconds)}));
  }
  function openShare(day,opener){if(disposed||!getSession()?.user)return;shareRevision++;shareDay=day;shareOwner=getOwner();shareOpener=opener;shareToggle.checked=false;sharePanel.hidden=false;paintShare();shareClose.focus({preventScroll:true});sharePanel.scrollIntoView?.({block:'nearest',behavior:'instant'});}
  shareClose.addEventListener('click',()=>closeShare());shareToggle.addEventListener('change',()=>{shareRevision++;shareBusy=false;shareSave.disabled=false;paintShare();});
  historyRoot.addEventListener('cancel',event=>{if(!sharePanel.hidden){event.preventDefault();closeShare();}});historyRoot.addEventListener('close',()=>closeShare({restore:false}));
  shareSave.addEventListener('click',()=>{if(shareBusy||!shareDay||shareOwner!==getOwner())return;shareBusy=true;shareSave.disabled=true;const revision=shareRevision,owner=shareOwner,date=shareDay.date;shareCanvas.toBlob(blob=>{if(disposed||sharePanel.hidden||revision!==shareRevision||owner!==getOwner())return;shareBusy=false;shareSave.disabled=false;if(!blob){own(shareStatus,{id:'journal.share.failed'});return;}const href=URL.createObjectURL(blob),link=document.createElement('a');link.href=href;link.download='leafhour-reading-'+date+'.png';link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);own(shareStatus,{id:'journal.share.saved'});},'image/png');});
  function openHistory(date){if(disposed)return;if(typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)){month=date.slice(0,7);selectedDate=date;}if(!historyRoot.open){historyRoot.showModal();onOverlay({kind:'calendar'});}renderCalendar();load();}
  historyButton.addEventListener('click',()=>openHistory());
  function activeBook(){return getBooks().find(b=>b.bookId===selectedBook)||null;}
  function renderToday(){
    const books=getBooks(),current=workspaceCurrentBook(books);if(!books.some(b=>b.bookId===selectedBook))selectedBook=current?.bookId||null;const book=activeBook();todayBook=book;todayPanel.hidden=!book;
    choice.replaceChildren(...books.map(b=>{const o=own(node('option'),{render:()=>b.title.zh+(b.journey?.status==='finished'?' · '+t('dash.choice.finishedSuffix'):'')});o.value=b.bookId;return o;}));choice.value=selectedBook||'';choice.hidden=books.length<2;
    title.textContent=book?.title.zh||'';author.textContent=book?.author||'';
    own(label,{render:()=>todayBook?.journey?.status==='finished'?t('dash.today.label.finished'):todayBook?.resume?t('dash.today.label.resume'):t('dash.today.label.start')});
    description.textContent=book?.resume?.label||'';read.hidden=!book;
    own(read,{render:()=>todayBook?.resume?t('dash.read.continue'):t('dash.read.open')});
    if(book)ownedLink(read,readingBookUrl(book));else read.removeAttribute('href');
    paintBookCover(illustration,book);options.hidden=!getSession()?.user;goalLabel.hidden=mark.hidden=!book||!getSession()?.user;
    goal.value=book?.journey?.dailyGoalMinutes||15;if(!goal.value&&book){const o=own(node('option'),{render:()=>t('unit.minutes',{minutes:num(book.journey.dailyGoalMinutes)})});o.value=book.journey.dailyGoalMinutes;goal.append(o);goal.value=o.value;}
    const journey=book?.journey;progress.hidden=!getSession()?.user||!journey;
    own(progress,{render:()=>{const j=todayBook?.journey;if(j?.status==='finished')return t('dash.progress.finished');if(j?.totalChapters)return t(todayBook?.source?.structure==='automatic_groups'?'dash.progress.segments':'dash.progress.chapters',{done:num(j.completedChapters),total:num(j.totalChapters)});return '';}});
    own(mark,{render:()=>todayBook?.journey?.status==='finished'?t('dash.mark.reopen'):t('dash.mark.finished')});
    loadPreview();onCurrentBook(book);
  }
  function renderOverview(){
    const overviewHadFocus=week.contains(document.activeElement),state=requests.view(),signedIn=!!getSession()?.user,currentMonth=today().slice(0,7),data=signedIn?overviewData:null,summary=journalMonthSummary(data,currentMonth);
    if(overviewFocusDate.slice(0,7)!==currentMonth)overviewFocusDate=today();
    overviewRoot.hidden=false;own(overviewMonth,{render:()=>new Intl.DateTimeFormat(getUiLocale(),{year:'numeric',month:'long',timeZone:'UTC'}).format(new Date(currentMonth+'-01T12:00:00Z'))});
    overviewSummary.hidden=!data;own(overviewTotal,{render:()=>duration(summary.durationSeconds)});own(overviewDays,{render:()=>t('journal.days',{count:num(summary.readingDays)})});week.setAttribute('aria-label',t('journal.selectDay'));week.setAttribute('aria-busy',String(!data&&state.status==='loading'));week.replaceChildren();
    for(const date of readingWeek(today()))week.append(own(node('span','journal-weekday'),{render:()=>weekday(date)}));
    for(const date of calendarMonth(currentMonth)){
      if(!date){week.append(node('span','journal-gap'));continue;}
      const day=data?.days.find(d=>d.date===date),level=journalDayLevel(day),cell=button('');cell.className='journal-day';cell.dataset.date=date;cell.dataset.level=String(level);cell.dataset.hasActivity=String(!!day&&(day.notes>0||day.questions>0||day.chapterMarks>0));cell.disabled=!signedIn;cell.tabIndex=date===overviewFocusDate?0:-1;const number=own(node('span','journal-day-number'),{render:()=>num(Number(date.slice(-2)))}),time=own(node('span','journal-day-duration'),{render:()=>day?.durationSeconds>0?(day.durationSeconds<60?'<1′':num(Math.floor(day.durationSeconds/60))+'′'):level?t('journal.activity'):''});cell.append(number,time);if(date===today())cell.setAttribute('aria-current','date');own(cell,{attr:'aria-label',render:()=>t('dash.day.aria',{date,status:!signedIn?t('dash.day.aria.guest'):!data&&state.status==='loading'?t('dash.day.aria.loading'):!data&&state.status==='error'?t('dash.day.aria.error'):day?t('dash.day.aria.summary',{time:duration(day.durationSeconds),notes:num(day.notes),questions:num(day.questions)}):t('dash.day.aria.empty')})});cell.addEventListener('focus',()=>{overviewFocusDate=date;for(const other of week.children)if(other.dataset.date)other.tabIndex=other.dataset.date===date?0:-1;});cell.addEventListener('keydown',event=>{const offset={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];if(offset===undefined)return;event.preventDefault();const dates=calendarMonth(currentMonth).filter(Boolean),target=dates[dates.indexOf(date)+offset];if(target){overviewFocusDate=target;for(const other of week.children)if(other.dataset.date)other.tabIndex=other.dataset.date===target?0:-1;week.querySelector('[data-date="'+target+'"]')?.focus();}});cell.addEventListener('click',()=>{openHistory(date);grid.querySelector('[data-date="'+date+'"]')?.focus({preventScroll:true});});week.append(cell);
    }
    if(overviewHadFocus&&!historyRoot.open)week.querySelector('[data-date="'+overviewFocusDate+'"]')?.focus({preventScroll:true});
    overviewBody.replaceChildren();
    if(!signedIn){const loginButton=ui('button','text-link','dash.overview.signIn');loginButton.addEventListener('click',()=>openAuth());overviewBody.append(loginButton);overviewLegend.hidden=true;return;}
    overviewLegend.hidden=!data;
    if(!data){const p=own(node('p','muted'),{render:()=>state.status==='error'?t('dash.calendar.error'):t('dash.overview.loading')});overviewBody.append(p);if(state.status==='error'){const again=ui('button','text-link','dash.calendar.retry');again.addEventListener('click',()=>{month=today().slice(0,7);load();});overviewBody.append(again);}return;}
    if(!summary.readingDays&&!summary.notes&&!summary.questions)overviewBody.append(ui('p','muted','journal.empty'));
  }
  function renderDetail(data){
    detail.replaceChildren();const day=data?.days.find(d=>d.date===selectedDate);
    detail.append(own(node('h3'),{render:dayHeading}));
    if(!day){detail.append(own(node('p','muted'),{render:()=>calendarSignedIn?t('dash.detail.hint'):t('dash.detail.guest')}));return;}
    detail.append(own(node('p','day-total'),{render:()=>duration(day.durationSeconds)}),own(node('p','day-counts'),{render:()=>t('dash.detail.counts',{notes:num(day.notes),questions:num(day.questions),marks:num(day.chapterMarks)})}));
    const measurement=node('details','journal-measurement'),measurementSummary=ui('summary','','journal.measurement');measurement.append(measurementSummary,own(node('p','reading-time-breakdown'),{render:()=>READING_TIME_SOURCES.map(source=>timeSourceLabel(source)+' '+duration(day.sourceDurationSeconds?.[source]||0)).join(' · ')}),ui('p','day-overlap','dash.detail.overlap'));detail.append(measurement);
    if(day.durationSeconds>0){const share=ui('button','text-link journal-day-share','journal.share.open');share.addEventListener('click',()=>openShare(day,share));detail.append(share);}
    if(!day.details.length){detail.append(own(node('p','day-empty'),{render:()=>selectedDate===today()?t('dash.detail.empty.today'):t('dash.detail.empty.day')}));return;}
    const href=item=>'/read?book='+encodeURIComponent(item.bookId)+(item.passageId?'&passage='+encodeURIComponent(item.passageId):'')+(['comment','question'].includes(item.type)?'&note='+item.type:'');
    const books=node('ul','day-books');books.setAttribute('aria-label',t('dash.detail.booksAria'));
    for(const book of [...(day.books||[])].sort((a,b)=>b.durationSeconds-a.durationSeconds)){
      const source=book.source||day.details.find(item=>item.bookId===book.bookId&&item.type==='reading')||day.details.find(item=>item.bookId===book.bookId),li=node('li'),link=node('a');
      ownedLink(link,href(source||book));link.append(node('strong','',book.title.zh));
      link.append(own(node('span'),{render:()=>{const s=[];if(book.durationSeconds)s.push(duration(book.durationSeconds));if(book.notes)s.push(t('dash.detail.notes',{count:num(book.notes)}));if(book.questions)s.push(t('dash.detail.questions',{count:num(book.questions)}));if(book.chapterMarks)s.push(t('dash.detail.marks',{count:num(book.chapterMarks)}));return s.join(' · ');}}));li.append(link);books.append(li);
      if(book.sourceDurationSeconds)link.append(own(node('small','reading-time-breakdown'),{render:()=>READING_TIME_SOURCES.filter(source=>book.sourceDurationSeconds[source]>0).map(source=>timeSourceLabel(source)+' '+duration(book.sourceDurationSeconds[source])).join(' · ')}));
    }
    detail.append(books);
    if((day.books||[]).reduce((sum,b)=>sum+b.durationSeconds,0)>day.durationSeconds)detail.append(ui('p','day-overlap','dash.detail.overlapBooks'));
    const history=node('details','day-history'),summary=own(node('summary'),{render:()=>t('dash.history.summary',{count:num(day.totalDetails)})}),list=node('ol','day-records');history.open=day.totalDetails<=3;history.append(summary,list);
    const stamp=date=>new Intl.DateTimeFormat(getUiLocale(),{timeZone:zone,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date);
    for(const item of day.details){
      const li=node('li'),link=node('a','day-record');ownedLink(link,href(item));
      link.append(own(node('small'),{render:()=>item.type==='reading'?timeSourceLabel(item.source):({comment:t('dash.record.comment'),question:t('dash.record.question'),chapter_read:t('dash.record.chapterRead'),book_finished:t('dash.mark.finished')}[item.type])||t('dash.record.other')}),node('strong','',item.title.zh));
      if(item.createdAt&&Number.isFinite(Date.parse(item.createdAt))){const createdAt=new Date(item.createdAt);const timeNode=own(node('time','record-time'),{render:()=>stamp(createdAt)});timeNode.dateTime=item.createdAt;link.append(timeNode);}
      if(item.text)link.append(node('p','',item.text));link.append(ui('span','record-return','dash.record.return'));li.append(link);list.append(li);
      if(item.type==='reading'&&item.segments?.length){const intervals=node('details','reading-time-intervals'),intervalList=node('ol'),format=date=>new Intl.DateTimeFormat(getUiLocale(),{timeZone:zone,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'shortOffset'}).format(date);intervals.append(own(node('summary'),{render:()=>t('dash.intervals.summary',{count:num(item.segments.length)})}),own(node('p'),{render:()=>t('dash.intervals.zone',{zone,timeZone:item.timeZone})}),intervalList);for(const segment of item.segments)intervalList.append(own(node('li'),{render:()=>format(new Date(segment.startedAt))+' → '+format(new Date(segment.endedAt))}));li.append(intervals);}
    }
    if(day.totalDetails>day.details.length)history.append(own(node('p','muted'),{render:()=>t('dash.history.more',{shown:num(day.details.length)})}));detail.append(history);
  }
  const dayStatus=(day,status)=>{
    if(!calendarSignedIn)return t('dash.day.aria.guest');
    if(status==='loading')return t('dash.day.aria.loading');
    if(status==='error')return t('dash.day.aria.error');
    return day?t('dash.day.aria.summary',{time:duration(day.durationSeconds),notes:num(day.notes),questions:num(day.questions)}):t('dash.day.aria.empty');
  };
  function renderCalendar(){
    const focusedDate=grid.contains(document.activeElement)?document.activeElement?.dataset.date:null;
    renderOverview();const state=requests.view(),data=state.data;calendarSignedIn=!!getSession()?.user;
    own(monthLabelNode,{render:monthHeading});retry.hidden=state.status!=='error';login.hidden=calendarSignedIn;
    own(calendarStatus,{render:()=>!calendarSignedIn?t('dash.calendar.guestStatus'):state.status==='loading'?t('dash.calendar.loading'):state.status==='error'?t('dash.calendar.error'):''});
    grid.setAttribute('aria-busy',String(state.status==='loading'));grid.replaceChildren();
    for(const date of readingWeek(today()))grid.append(own(node('span','calendar-weekday'),{render:()=>weekday(date)}));
    for(const date of calendarMonth(month)){
      if(!date){grid.append(node('span','calendar-gap'));continue;}
      const day=data?.days.find(d=>d.date===date),hasRecord=!!day&&(day.durationSeconds>0||day.notes||day.questions||day.chapterMarks),b=node('button','',num(Number(date.slice(-2))));
      b.dataset.date=date;b.className='calendar-day'+(hasRecord?' has-reading':'')+(date===today()?' is-today':'');b.setAttribute('aria-pressed',String(date===selectedDate));
      b.setAttribute('aria-label',t('dash.day.aria',{date,status:dayStatus(day,state.status)}));
      labels.set(b,{render:()=>{b.setAttribute('aria-label',t('dash.day.aria',{date,status:dayStatus(day,state.status)}));return b.textContent;}});
      if(date===today())b.setAttribute('aria-current','date');b.tabIndex=date===selectedDate?0:-1;
      b.addEventListener('click',()=>{closeShare({restore:false});selectedDate=date;renderCalendar();grid.querySelector('[data-date="'+date+'"]').focus();});
      b.addEventListener('keydown',e=>{const offset={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[e.key];if(offset===undefined)return;e.preventDefault();const cells=calendarMonth(month).filter(Boolean),index=cells.indexOf(date)+offset;if(cells[index]){selectedDate=cells[index];renderCalendar();grid.querySelector('[data-date="'+selectedDate+'"]').focus();}});
      grid.append(b);
    }
    own(stats,{render:()=>data?t('dash.stats',{days:num(data.readingDays),time:duration(data.durationSeconds),notes:num(data.notes)}):''});
    own(sourceStats,{render:()=>data?READING_TIME_SOURCES.map(source=>timeSourceLabel(source)+' '+duration(data.sourceDurationSeconds?.[source]||0)).join(' · '):''});
    renderDetail(data);
    if(focusedDate&&historyRoot.open)grid.querySelector('[data-date="'+selectedDate+'"]')?.focus({preventScroll:true});
  }
  async function load(){if(disposed)return;if(!getSession()?.user){requests.clear();renderCalendar();return;}const owner=getOwner(),ticket=requests.begin(owner,month);renderCalendar();try{const result=await loadWorkspaceActivity(api,{month,date:today(),timeZone:zone});if(disposed||owner!==getOwner()||!requests.resolve(ticket,result.calendar))return;if(result.overview)overviewData=result.overview;renderCalendar();}catch(error){if(disposed||owner!==getOwner())return;if(requests.reject(ticket,error)){closeShare({restore:false});renderCalendar();}}}
  function changeMonth(offset){closeShare({restore:false});month=shiftReadingMonth(month,offset);selectedDate=month===today().slice(0,7)?today():month+'-01';load();}
  prev.addEventListener('click',()=>changeMonth(-1));next.addEventListener('click',()=>changeMonth(1));thisMonth.addEventListener('click',()=>{closeShare({restore:false});month=today().slice(0,7);selectedDate=today();load();});retry.addEventListener('click',async()=>{const hadFocus=document.activeElement===retry;let moved=false;const track=event=>{if(event.target!==retry&&event.target!==document.body)moved=true;};document.addEventListener('focusin',track);try{await load();}finally{document.removeEventListener('focusin',track);if(!disposed&&hadFocus&&!moved&&historyRoot.open&&retry.hidden&&(document.activeElement===document.body||document.activeElement===retry))grid.querySelector('[data-date="'+selectedDate+'"]')?.focus({preventScroll:true});}});login.addEventListener('click',()=>openAuth());choice.addEventListener('change',()=>{selectedBook=choice.value;renderToday();});
  async function write(path,data,trigger){if(busy)return;const book=activeBook(),owner=getOwner();if(!book||!getSession()?.user)return;const focus=trackActionFocus(document,trigger);busy=true;writeMessage={id:'dash.write.saving'};writeStatus.classList.remove('error');goal.disabled=mark.disabled=choice.disabled=true;apply(writeStatus,writeMessage);try{await api('/api/library/books/'+encodeURIComponent(book.bookId)+'/'+path,data);if(disposed||owner!==getOwner())return;await refresh();writeMessage={id:'dash.write.saved'};apply(writeStatus,writeMessage);}catch(error){if(!disposed&&owner===getOwner()){renderToday();writeMessage={id:'dash.write.failed'};apply(writeStatus,writeMessage);writeStatus.classList.add('error');}}finally{if(!disposed&&owner===getOwner()){busy=false;goal.disabled=mark.disabled=choice.disabled=false;focus.restore(trigger);}else focus.stop();}}
  goal.addEventListener('change',()=>write('reading-goal',{minutes:Number(goal.value)},goal));mark.addEventListener('click',()=>write('reading-milestones',{id:crypto.randomUUID(),type:activeBook()?.journey?.status==='finished'?'book_reopened':'book_finished',createdAt:new Date().toISOString()},mark));
  function updateLabels(){
    if(disposed)return;
    for(const [n,spec] of labels){if(n.isConnected===false){labels.delete(n);continue;}apply(n,spec);}
    for(const link of [...links]){if(link.isConnected===false){links.delete(link);continue;}link.href=uiHref(link.getAttribute('data-ui-owned-href')||'');}
    choice.setAttribute('aria-label',t('dash.choice.aria'));goal.setAttribute('aria-label',t('dash.goal.aria'));questionSlip.setAttribute('aria-label',t('dash.question.label'));grid.setAttribute('aria-label',t('dash.calendar.selectDate'));
    week.setAttribute('aria-label',t('journal.selectDay'));
    if(writeMessage)apply(writeStatus,writeMessage);
    if(shareDay&&!sharePanel.hidden)paintShare();
  }
  const offLocale=onUiLocaleChange(updateLabels);void uiReady.then(updateLabels);
  return {openHistory,getCurrentBook:activeBook,isLoading:()=>!loading.hidden,updateLabels,begin(){if(!todayPanel.hidden)return null;loadError.hidden=true;return arrival.start();},fail(error,ticket){if(ticket!==null&&!arrival.finish(ticket))return;requests.clear();if(ticket!==null)todayPanel.hidden=true;overviewData=null;overviewBody.replaceChildren();loadError.hidden=false;own(loadError,{id:'dash.load.failed'});},update(ticket){if(ticket!==null&&!arrival.finish(ticket))return;loadError.hidden=true;renderToday();if(!historyRoot.open){month=today().slice(0,7);selectedDate=today();}if(historyRoot.open||!overviewRoot.hidden)load();},dispose(){if(disposed)return;closeShare({restore:false});disposed=true;offLocale();arrival.dispose?.();requests.clear();labels.clear();links.clear();},clear(){closeShare({restore:false});requests.clear();overviewData=null;selectedBook=null;previewKey=null;preview=null;previewSequence++;renderQuestion();excerptText.textContent='';options.open=false;writeMessage=null;writeStatus.textContent='';busy=false;goal.disabled=mark.disabled=choice.disabled=false;calendarStatus.classList.remove('error');renderToday();renderCalendar();}};
}
