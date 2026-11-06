// Multi-voice audiobook narration: parse books into narration vs dialogue segments
// Handles Chinese quotes (「」『』), Western quotes (""), and dialogue tags

import {audioError} from './audio-content.mjs';

// Dialogue markers for speaker attribution
const chineseQuotes = /[「『]([^」』]+)[」』]/g;
const westernQuotes = /["']([^"']+)["']/g;
const dialogueVerbs = {
  zh: ['说', '道', '问', '答', '回答', '喊', '叫', '笑', '哭', '低声说', '大声说', '轻声说'],
  en: ['said', 'asked', 'replied', 'answered', 'shouted', 'whispered', 'cried', 'laughed', 'yelled']
};

/**
 * Parse a paragraph into narration and dialogue segments
 * @param {object} passage - {id, original, translations, chapterId}
 * @param {string} language - 'zh' or 'en'
 * @param {string} variant - 'literal' or 'interpretive'
 * @returns {Array} segments with {type: 'narration'|'dialogue', text, speaker, tag, start, end}
 */
export function parsePassage(passage, language = 'zh', variant = 'interpretive') {
  const text = language === 'en' ? passage.original : 
               passage.translations?.[variant]?.text;
  
  if (!text || typeof text !== 'string') {
    throw audioError('段落文本不可用。');
  }

  const segments = [];
  const quotes = language === 'zh' ? chineseQuotes : westernQuotes;
  
  // Find all quoted segments
  const matches = [...text.matchAll(quotes)];
  
  if (matches.length === 0) {
    // No dialogue, entire paragraph is narration
    return [{
      type: 'narration',
      text,
      start: 0,
      end: text.length,
      passageId: passage.id
    }];
  }

  let lastEnd = 0;
  const verbs = dialogueVerbs[language] || dialogueVerbs.en;
  
  for (const match of matches) {
    const dialogueStart = match.index;
    const dialogueEnd = dialogueStart + match[0].length;
    const dialogueText = match[1];
    
    // Check for dialogue tag before or after
    const before = text.slice(Math.max(0, lastEnd), dialogueStart);
    const after = text.slice(dialogueEnd, Math.min(text.length, dialogueEnd + 50));
    
    let tag = null;
    let speaker = null;
    
    // Look for dialogue verbs nearby
    for (const verb of verbs) {
      const pattern = new RegExp(`([^，。！？：""''「」『』]+)${verb}`, 'g');
      const beforeMatch = before.match(pattern);
      const afterMatch = after.match(pattern);
      
      if (beforeMatch) {
        tag = beforeMatch[beforeMatch.length - 1];
        speaker = beforeMatch[0].replace(verb, '').trim();
      } else if (afterMatch) {
        tag = afterMatch[0];
        speaker = afterMatch[0].replace(verb, '').trim();
      }
      
      if (speaker) break;
    }
    
    // Add narration before dialogue (including dialogue tag)
    if (lastEnd < dialogueStart || (tag && before.includes(tag))) {
      const narrationEnd = tag ? text.indexOf(tag, lastEnd) + tag.length : dialogueStart;
      const narrationText = text.slice(lastEnd, narrationEnd).trim();
      if (narrationText) {
        segments.push({
          type: 'narration',
          text: narrationText,
          start: lastEnd,
          end: narrationEnd,
          passageId: passage.id
        });
      }
    }
    
    // Add dialogue
    segments.push({
      type: 'dialogue',
      text: dialogueText,
      speaker: speaker || 'unknown',
      tag,
      start: dialogueStart + 1, // Skip opening quote
      end: dialogueEnd - 1, // Skip closing quote
      passageId: passage.id
    });
    
    lastEnd = dialogueEnd;
  }
  
  // Add remaining narration
  if (lastEnd < text.length) {
    const remaining = text.slice(lastEnd).trim();
    if (remaining) {
      segments.push({
        type: 'narration',
        text: remaining,
        start: lastEnd,
        end: text.length,
        passageId: passage.id
      });
    }
  }
  
  return segments;
}

/**
 * Identify non-spoken quoted text (signs, titles, letters, thoughts)
 * @param {string} text - surrounding context
 * @param {string} quote - quoted text
 * @returns {boolean} true if NOT spoken dialogue
 */
export function isNonDialogueQuote(text, quote) {
  const markers = {
    zh: ['标题', '题目', '写着', '上面写', '想到', '心想', '想着'],
    en: ['title', 'sign', 'read', 'thought', 'thinking', 'wondered']
  };
  
  // Very short quotes are usually not dialogue (interjections, signs, etc.)
  if (quote.length <= 3) return true;
  
  const lower = text.toLowerCase();
  return markers.zh.some(m => text.includes(m)) ||
         markers.en.some(m => lower.includes(m));
}

/**
 * Parse entire chapter into narration/dialogue segments
 * @param {object} book - book data structure
 * @param {string} chapterId - chapter identifier
 * @param {string} language - 'zh' or 'en'
 * @param {string} variant - 'literal' or 'interpretive'
 * @returns {Array} all segments with passage metadata
 */
export function parseChapter(book, chapterId, language = 'zh', variant = 'interpretive') {
  const section = book.sections?.find(s => s.chapterId === chapterId);
  if (!section) {
    throw audioError('找不到这一章。');
  }
  
  const allSegments = [];
  
  for (const paragraph of section.paragraphs || []) {
    const passage = {
      id: paragraph.id,
      original: paragraph.original,
      translations: paragraph.translations,
      chapterId
    };
    
    const segments = parsePassage(passage, language, variant);
    allSegments.push(...segments);
  }
  
  return allSegments;
}

/**
 * Analyze speaker patterns in segments to rank by importance
 * @param {Array} segments - parsed segments
 * @returns {Map} speaker → {lineCount, characterCount, firstAppearance}
 */
export function analyzeCharacters(segments) {
  const stats = new Map();
  
  segments.forEach((seg, index) => {
    if (seg.type === 'dialogue' && seg.speaker && seg.speaker !== 'unknown') {
      if (!stats.has(seg.speaker)) {
        stats.set(seg.speaker, {
          lineCount: 0,
          characterCount: 0,
          firstAppearance: index,
          speaker: seg.speaker
        });
      }
      const s = stats.get(seg.speaker);
      s.lineCount++;
      s.characterCount += seg.text.length;
    }
  });
  
  return stats;
}
