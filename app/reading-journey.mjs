export function readingJourney(book,records){
  const chapters=book.chapters.filter(c=>!c.kind||c.kind==='body'),chapterStatuses=Object.fromEntries(chapters.map(c=>[c.id,'unread']));let status='reading',finishedAt=null;
  const milestones=[...(records.readingMilestones||[])].filter(r=>r.origin==='user'&&r.bookId===book.bookId&&r.contentVersion===book.contentVersion).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt));
  for(const mark of milestones){if(mark.type==='book_finished'){status='finished';finishedAt=mark.createdAt;}else if(mark.type==='book_reopened'){status='reading';finishedAt=null;}else if(Object.hasOwn(chapterStatuses,mark.chapterId))chapterStatuses[mark.chapterId]=mark.type==='chapter_read'?'read':'unread';}
  const real=(records.readingSessions||[]).filter(s=>s.source==='reader_focus'&&s.durationSeconds>0);
  return {status,finishedAt,chapterStatuses,completedChapters:Object.values(chapterStatuses).filter(s=>s==='read').length,totalChapters:chapters.length,dailyGoalMinutes:records.readingGoal?.minutes||15,lastReadAt:real.sort((a,b)=>Date.parse(b.endedAt)-Date.parse(a.endedAt))[0]?.endedAt||null};
}
