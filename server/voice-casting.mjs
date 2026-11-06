// Voice casting system: assign stable voices to characters across a book
// Maintains voice bible (voice IDs, speeds, pronunciation) per book

import {audioError, audioHash} from './audio-content.mjs';

/**
 * Voice cast template per language and provider
 */
const voiceCasts = {
  // ElevenLabs English voices
  elevenlabs_en: {
    narrator: {id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', role: 'narrator'},
    male_default: {id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', role: 'male_default'},
    female_default: {id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', role: 'female_default'},
    // Character voices pool
    male_1: {id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', role: 'character'},
    male_2: {id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', role: 'character'},
    female_1: {id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', role: 'character'},
    female_2: {id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', role: 'character'}
  },
  
  // Alibaba Qwen Chinese voices
  qwen_zh: {
    narrator: {id: 'narrator_001', name: '女声旁白', role: 'narrator'},
    male_default: {id: 'male_default_001', name: '男声默认', role: 'male_default'},
    female_default: {id: 'female_default_001', name: '女声默认', role: 'female_default'},
    male_1: {id: 'male_character_001', name: '男声角色一', role: 'character'},
    male_2: {id: 'male_character_002', name: '男声角色二', role: 'character'},
    female_1: {id: 'female_character_001', name: '女声角色一', role: 'character'},
    female_2: {id: 'female_character_002', name: '女声角色二', role: 'character'}
  },
  
  // MiniMax Chinese voices
  minimax_zh: {
    narrator: {id: 'narrator_neutral', name: '中性旁白', role: 'narrator'},
    male_default: {id: 'male_standard', name: '男声标准', role: 'male_default'},
    female_default: {id: 'female_standard', name: '女声标准', role: 'female_default'},
    male_1: {id: 'male_young', name: '男声青年', role: 'character'},
    male_2: {id: 'male_mature', name: '男声成熟', role: 'character'},
    female_1: {id: 'female_young', name: '女声青年', role: 'character'},
    female_2: {id: 'female_mature', name: '女声成熟', role: 'character'}
  }
};

/**
 * Detect gender from Chinese pronouns or name patterns
 * @param {string} speaker - character identifier
 * @param {string} text - dialogue text
 * @returns {string} 'male'|'female'|'unknown'
 */
function detectGender(speaker, text) {
  const malePro = /他(?![们的])/g;
  const femalePro = /她(?![们的])/g;
  
  const maleCount = (text.match(malePro) || []).length;
  const femaleCount = (text.match(femalePro) || []).length;
  
  if (femaleCount > maleCount) return 'female';
  if (maleCount > femaleCount) return 'male';
  
  // Check common name patterns (simplified)
  const femaleNames = ['小姐', '女士', '夫人', '母亲', '妈妈', '姐姐', '妹妹'];
  const maleNames = ['先生', '父亲', '爸爸', '哥哥', '弟弟'];
  
  const lower = speaker.toLowerCase();
  if (femaleNames.some(n => lower.includes(n))) return 'female';
  if (maleNames.some(n => lower.includes(n))) return 'male';
  
  return 'unknown';
}

/**
 * Create voice bible for a book
 * @param {object} book - book data
 * @param {Array} segments - parsed dialogue segments
 * @param {object} characterStats - from analyzeCharacters
 * @param {string} provider - 'elevenlabs'|'qwen'|'minimax'
 * @param {string} language - 'zh'|'en'
 * @returns {object} voice bible with cast assignments
 */
export function createVoiceBible(book, segments, characterStats, provider = 'elevenlabs', language = 'en') {
  const castKey = `${provider}_${language}`;
  const availableVoices = voiceCasts[castKey];
  
  if (!availableVoices) {
    throw audioError(`不支持的声音组合: ${provider} + ${language}`);
  }
  
  // Sort characters by importance (line count + character count)
  const ranked = Array.from(characterStats.values())
    .sort((a, b) => (b.lineCount + b.characterCount / 100) - (a.lineCount + a.characterCount / 100));
  
  const assignments = new Map();
  const usedVoices = new Set();
  
  // Always assign narrator
  assignments.set('narrator', availableVoices.narrator);
  usedVoices.add(availableVoices.narrator.id);
  
  // Assign voices to major characters
  const characterPool = Object.values(availableVoices).filter(v => v.role === 'character');
  let characterIndex = 0;
  
  for (const char of ranked) {
    if (char.lineCount < 3) {
      // Minor character: use gender default
      const gender = detectGender(char.speaker, 
        segments.find(s => s.speaker === char.speaker)?.text || '');
      
      if (gender === 'male') {
        assignments.set(char.speaker, availableVoices.male_default);
      } else if (gender === 'female') {
        assignments.set(char.speaker, availableVoices.female_default);
      } else {
        assignments.set(char.speaker, availableVoices.narrator);
      }
    } else {
      // Major character: assign unique voice
      if (characterIndex < characterPool.length) {
        const voice = characterPool[characterIndex];
        assignments.set(char.speaker, voice);
        usedVoices.add(voice.id);
        characterIndex++;
      } else {
        // Ran out of character voices, fall back to gender default
        const gender = detectGender(char.speaker,
          segments.find(s => s.speaker === char.speaker)?.text || '');
        assignments.set(char.speaker, 
          gender === 'female' ? availableVoices.female_default : availableVoices.male_default);
      }
    }
  }
  
  const bible = {
    bookId: book.bookId,
    contentVersion: book.contentVersion,
    provider,
    language,
    created: new Date().toISOString(),
    assignments: Object.fromEntries(assignments),
    pronunciationDict: {}, // Can be extended later
    globalSpeed: 1.0,
    model: provider === 'elevenlabs' ? 'eleven_multilingual_v2' : 
           provider === 'qwen' ? 'qwen-audio-3.1-tts-plus' :
           'speech-2.8-hd' // minimax
  };
  
  // Generate stable ID
  bible.id = audioHash([book.bookId, provider, language, bible.created]);
  
  return bible;
}

/**
 * Get voice for a segment based on voice bible
 * @param {object} segment - dialogue or narration segment
 * @param {object} voiceBible - voice cast assignments
 * @returns {object} {voiceId, voiceName, role}
 */
export function getVoiceForSegment(segment, voiceBible) {
  if (!voiceBible || !voiceBible.assignments) {
    throw audioError('声音分配表不存在。');
  }
  
  if (segment.type === 'narration') {
    return voiceBible.assignments.narrator;
  }
  
  // Dialogue
  const speaker = segment.speaker === 'unknown' ? 'narrator' : segment.speaker;
  const assigned = voiceBible.assignments[speaker];
  
  if (!assigned) {
    // Fallback to narrator for unassigned speakers
    return voiceBible.assignments.narrator;
  }
  
  return assigned;
}

/**
 * Validate voice bible against current book version
 * @param {object} voiceBible - stored voice bible
 * @param {object} book - current book data
 * @returns {boolean} true if still valid
 */
export function validateVoiceBible(voiceBible, book) {
  if (!voiceBible || !book) return false;
  
  return voiceBible.bookId === book.bookId &&
         voiceBible.contentVersion === book.contentVersion;
}
