import {ensureShareFonts,ensureShareCjkFonts} from './share-fonts.mjs';
import {READING_TIME_SOURCES} from './reading-time-policy.mjs';
const seconds=value=>Number.isFinite(value)&&value>0?value:0;
export function journalMonthSummary(data,month){
 const days=(data?.days||[]).filter(day=>day.date?.slice(0,7)===month);
 return {durationSeconds:days.reduce((sum,day)=>sum+seconds(day.durationSeconds),0),readingDays:days.filter(day=>seconds(day.durationSeconds)>0||day.chapterMarks>0).length,notes:days.reduce((sum,day)=>sum+seconds(day.notes),0),questions:days.reduce((sum,day)=>sum+seconds(day.questions),0)};
}
export function journalDayLevel(day){
 const duration=seconds(day?.durationSeconds);return duration>=3600?4:duration>=1200?3:duration>0?2:day&&(day.notes>0||day.questions>0||day.chapterMarks>0)?1:0;
}
// A small allowlist is the complete share boundary. Never spread a calendar day
// into the model: it also contains private comments, questions and source IDs.
export function buildReadingJournalShare(day,{includeBookTitles=false}={}){
 if(typeof day?.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day.date)||!Number.isFinite(Date.parse(day.date+'T12:00:00Z'))||new Date(day.date+'T12:00:00Z').toISOString().slice(0,10)!==day.date||!Number.isFinite(day.durationSeconds)||day.durationSeconds<0)throw Error('Invalid reading day');
 return {date:day.date,durationSeconds:day.durationSeconds,sourceDurationSeconds:Object.fromEntries(READING_TIME_SOURCES.filter(source=>seconds(day.sourceDurationSeconds?.[source])>0).map(source=>[source,day.sourceDurationSeconds[source]])),bookTitles:includeBookTitles?(day.books||[]).filter(book=>typeof book.title?.zh==='string'||typeof book.title==='string').map(book=>typeof book.title==='string'?book.title:book.title.zh):[]};
}

export async function prepareReadingJournalShare(fonts,model,copy){
 const text=[copy.title,copy.dateLabel,copy.timeLabel,copy.bookLabel,copy.returnLabel,copy.overlapLabel,...model.bookTitles,...Object.entries(model.sourceDurationSeconds).map(([source,value])=>copy.sourceLabels[source]?.(value)||source)].filter(Boolean).join(' ');
 const [latin,cjk]=await Promise.all([ensureShareFonts(fonts),ensureShareCjkFonts(fonts,text)]);return {latin,cjk};
}

// Canvas uses only text and geometric marks. No book images, fonts, private
// links or network requests are embedded in the output.
export function paintReadingJournalShare(canvas,model,{locale='en',title,dateLabel,timeLabel,sourceLabels={},bookLabel,returnLabel,overlapLabel}={}){
 canvas.width=1200;canvas.height=1500;const c=canvas.getContext('2d');
 const sans='-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Leafhour CJK", sans-serif',serif='"Leafhour Serif", Georgia, "Songti SC", "Noto Serif CJK SC", "Leafhour CJK", serif';
 c.fillStyle='#f4f3ea';c.fillRect(0,0,1200,1500);c.fillStyle='#294a36';
 c.lineWidth=2;c.strokeStyle='#a9b49e';c.beginPath();c.moveTo(94,165);c.lineTo(1106,165);c.stroke();
 c.font='40px '+sans;c.fillText('Leafhour',94,112);c.textAlign='right';c.font='40px '+sans;c.fillText(title,1106,112);c.textAlign='left';
 c.font='40px '+sans;c.fillText(dateLabel,94,251);
 c.font='310px '+serif;c.fillText(String(Number(model.date.slice(-2))),77,565);
 c.font='84px '+serif;c.fillText(timeLabel,94,735);
 c.strokeStyle='#c7cebc';c.beginPath();c.moveTo(94,793);c.lineTo(1106,793);c.stroke();
 const fit=(text,width)=>{const chars=[...String(text)];while(chars.length&&c.measureText(chars.join('')+(chars.length<[...String(text)].length?'…':'')).width>width)chars.pop();return chars.length<[...String(text)].length?chars.join('')+'…':String(text);};
 let y=860;c.font='40px '+sans;
 for(const [source,value] of Object.entries(model.sourceDurationSeconds)){c.fillStyle='#52624f';c.fillText(fit(sourceLabels[source]?.(value)||source,970),94,y);y+=48;}
 if(Object.values(model.sourceDurationSeconds).reduce((sum,value)=>sum+value,0)>model.durationSeconds){c.font='38px '+sans;c.fillText(fit(overlapLabel||'',970),94,y);y+=42;}
 if(model.bookTitles.length){y=Math.max(y+25,1070);c.fillStyle='#52624f';c.font='38px '+sans;c.fillText(bookLabel,94,y);y+=50;c.fillStyle='#294a36';c.font='40px '+serif;const visible=model.bookTitles.slice(0,4);for(const name of visible){c.fillText(fit(name,970),94,y);y+=49;}if(model.bookTitles.length>visible.length){c.font='38px '+sans;c.fillText('+'+new Intl.NumberFormat(locale).format(model.bookTitles.length-visible.length),94,y);}}
 c.fillStyle='#52624f';c.font='40px '+sans;c.fillText(returnLabel,94,1410);c.textAlign='right';c.fillText('leafhour.com',1106,1410);c.textAlign='left';
 return canvas;
}
