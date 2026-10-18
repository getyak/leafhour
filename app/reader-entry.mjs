import {chooseReadingPosition} from './reading-progress.mjs';
import {resolveReaderEntry} from './reader-return.mjs';
import {chineseSampleEntry} from './catalog-sample.mjs';
import {entryViewPreferences,openingReadingView} from './reading-preferences.mjs';

// GET-186 reader entry policy. This is the single decision the reader boot
// applies before its first layout: which chapter opens and whether an anchor
// is restored at all.
//
// Precedence (unchanged from the historical boot):
//   1. explicit passage / citation / translation / note entry,
//   2. the published Chinese sample entry,
//   3. a validated saved position (remote and local per chooseReadingPosition),
//   4. a genuinely fresh or invalid-position opening.
//
// Only case 4 returns `position: null`, which the boot renders as the top of
// the opening chapter: the full generated chapter number and title stay
// visible. Validated resumes keep their saved offset/withinParagraph so some
// context above the paragraph remains; explicit entries keep their deliberate
// paragraph alignment. No progress is erased and no fake zero position is
// persisted here.
export function resolveReaderOpening({book,query=new URLSearchParams(),remote=null,local=null,remoteAvailable=true,hasPassage=()=>true,chapterOf=()=>undefined,state={},account=null,sourceOnly=false}={}){
  const chosen=chooseReadingPosition({book,remote,local,remoteAvailable});
  const position=chosen&&Number.isFinite(chosen.offset)&&Math.abs(chosen.offset)<=4000&&hasPassage(chosen.passageId)?{...chosen,chapterId:chapterOf(chosen.passageId)||chosen.chapterId}:null;
  const requestedEntry=resolveReaderEntry(book,query);
  const sampleEntry=!requestedEntry&&chineseSampleEntry(book,query);
  const entry=requestedEntry?{chapterId:requestedEntry.chapterId,passageId:requestedEntry.passageId,offset:requestedEntry.offset,withinParagraph:undefined,preferences:entryViewPreferences(requestedEntry)}:sampleEntry?{chapterId:sampleEntry.chapterId,passageId:sampleEntry.passageId,offset:sampleEntry.offset,withinParagraph:undefined,preferences:{mode:sampleEntry.mode,variant:sampleEntry.variant}}:null;
  const view=openingReadingView({saved:position,account,sourceOnly}),preferences={...view,...(entry?entry.preferences:{})};
  if(entry){
    const opening={...(position||{}),...state,...preferences,chapterId:entry.chapterId,passageId:entry.passageId,offset:entry.offset,withinParagraph:undefined,contentVersion:book.contentVersion};
    return {chapterId:entry.chapterId,saved:position,chosen,requestedEntry,sampleEntry,preferences,position:opening};
  }
  return {chapterId:position?.chapterId||state.chapterId||book.readingStart?.chapterId||book.chapters[0]?.id,saved:position,chosen,requestedEntry:null,sampleEntry:null,preferences,position};
}
