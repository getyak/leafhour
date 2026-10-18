import {fail} from './document-import.mjs';
import {isDeepStrictEqual} from 'node:util';

// Server-side fences for translate(user,id,passageId,options). They exist for
// every caller of the legacy route and for bounded batch runs (GET-151): an
// optional expected content version must be rejected before any provider
// request, and generation results may only be saved against the exact source
// and account they were generated for.

// Legacy callers pass no options and keep their exact behavior.
export function translationRequestOptions(options){
  if(options===undefined)return {};
  if(!options||typeof options!=='object'||Array.isArray(options))throw fail('翻译请求参数不正确');
  if(Object.keys(options).some(key=>key!=='expectedContentVersion'))throw fail('翻译请求参数不正确');
  const expected=options.expectedContentVersion;
  if(expected!==undefined&&(typeof expected!=='string'||!expected.length||expected.length>128))throw fail('翻译请求的原文版本不正确');
  return expected===undefined?{}:{expectedContentVersion:expected};
}

export function assertExpectedContentVersion(book,expected){
  if(expected!==undefined&&expected!==book.contentVersion)throw fail('原文版本已变化，请重新载入后再翻译',409);
}

// Versioned requests are batch requests: either both variants are absent,
// or no generation is authorized. Complete pairs may be returned unchanged.
export function assertBatchPassage(passage,expected){
  if(expected===undefined)return;
  const present=['literal','interpretive'].filter(key=>typeof passage?.translations?.[key]?.text==='string'&&passage.translations[key].text.trim());
  if(present.length===1)throw fail('已有部分译文，请先复核；批处理不会覆盖或补写该段',409);
}

// Re-read source and ownership before saving: a source updated or deleted
// during generation must never be recreated and must never publish a stale
// translation overlay onto the new source.
export function assertGenerationSource({book,fresh,passage,freshPassage}){
  if(!fresh||fresh.bookId!==book.bookId)throw fail('找不到这本书',404);
  if(!freshPassage||freshPassage.id!==passage.id||freshPassage.original!==passage.original||fresh.contentVersion!==book.contentVersion)throw fail('原文在翻译期间已更新，本次结果未保存',409);
}

// Before saving, never overwrite a reviewed translation or a version that was
// added or changed concurrently while this generation was in flight. Only an
// unchanged pre-existing draft may be regenerated, which keeps the legacy
// single-paragraph retry compatible.
export function mergeGeneratedTranslations({existing,before,generated}){
  const merged={};
  for(const variant of ['literal','interpretive']){
    const current=existing?.[variant],prior=before?.[variant];
    const preserve=current&&(current.status==='reviewed'||!prior||!isDeepStrictEqual(current,prior));
    merged[variant]=preserve?current:generated[variant];
  }
  return merged;
}
