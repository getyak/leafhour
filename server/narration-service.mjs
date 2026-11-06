// Narration service: orchestrates multi-voice audiobook generation
// Integrates parsing, casting, and provider selection

import {audioError, audioHash} from './audio-content.mjs';
import {parseChapter, parsePassage, analyzeCharacters} from './narration-parser.mjs';
import {createVoiceBible, getVoiceForSegment, validateVoiceBible} from './voice-casting.mjs';
import {
  detectLanguage,
  selectProvider,
  createElevenLabsProvider,
  createQwenProvider,
  createMiniMaxProvider,
  createFishProvider,
  stitchAudioSegments
} from './narration-providers.mjs';

/**
 * Create narration service
 * @param {object} options - {store, getBook, env, fetcher}
 * @returns {object} service methods
 */
export function createNarrationService({store, getBook, env = process.env, fetcher = fetch} = {}) {
  const providers = {
    elevenlabs: createElevenLabsProvider({env, fetcher}),
    qwen: createQwenProvider({env, fetcher}),
    minimax: createMiniMaxProvider({env, fetcher}),
    fish: createFishProvider({env, fetcher})
  };
  
  return {
    /**
     * Get available narration capabilities
     */
    async getCapabilities() {
      return {
        providers: {
          elevenlabs: providers.elevenlabs.available,
          qwen: providers.qwen.available,
          minimax: providers.minimax.available,
          fish: providers.fish.available && providers.fish.experimental
        },
        languages: {
          zh: providers.qwen.available || providers.minimax.available || providers.elevenlabs.available,
          en: providers.elevenlabs.available,
          other: providers.elevenlabs.available
        }
      };
    },
    
    /**
     * Prepare narration for a chapter
     * @param {string} ownerId - user ID
     * @param {string} bookId - book ID
     * @param {string} chapterId - chapter ID
     * @param {object} options - {language, variant, providerOverride}
     * @returns {object} {segments, voiceBible, estimatedCost}
     */
    async prepareChapterNarration(ownerId, bookId, chapterId, options = {}) {
      const book = await getBook(ownerId, bookId);
      if (!book) {
        throw audioError('找不到这本书。', 404);
      }
      
      const language = options.language || 'zh';
      const variant = options.variant || 'interpretive';
      
      // Parse chapter into segments
      const segments = parseChapter(book, chapterId, language, variant);
      
      if (segments.length === 0) {
        throw audioError('这一章没有可朗读的内容。');
      }
      
      // Analyze characters
      const characterStats = analyzeCharacters(segments);
      
      // Detect language from actual content
      const sampleText = segments.slice(0, 10).map(s => s.text).join(' ');
      const detectedLanguage = detectLanguage(sampleText);
      
      // Select provider
      const provider = selectProvider(detectedLanguage, env, options.providerOverride);
      
      // Get or create voice bible
      let voiceBible = await store.getVoiceBible(ownerId, bookId);
      
      if (!voiceBible || !validateVoiceBible(voiceBible, book)) {
        // Create new voice bible
        voiceBible = createVoiceBible(book, segments, characterStats, provider, detectedLanguage);
        await store.saveVoiceBible(ownerId, bookId, voiceBible);
      }
      
      // Estimate cost
      const totalCharacters = segments.reduce((sum, s) => sum + s.text.length, 0);
      const estimatedCost = this.estimateCost(provider, totalCharacters, segments.length);
      
      return {
        segments: segments.map(s => ({
          type: s.type,
          text: s.text,
          speaker: s.speaker,
          passageId: s.passageId,
          voice: getVoiceForSegment(s, voiceBible)
        })),
        voiceBible,
        provider,
        language: detectedLanguage,
        estimatedCost
      };
    },
    
    /**
     * Generate narration audio for segments
     * @param {string} ownerId - user ID
     * @param {string} bookId - book ID
     * @param {Array} segments - prepared segments with voice assignments
     * @param {object} voiceBible - voice bible
     * @param {object} signal - AbortSignal
     * @returns {Array} audio clips {segmentIndex, bytes, mimeType, generationId}
     */
    async generateNarration(ownerId, bookId, segments, voiceBible, signal) {
      if (!voiceBible || !voiceBible.provider) {
        throw audioError('声音配置无效。');
      }
      
      const provider = providers[voiceBible.provider];
      if (!provider || !provider.available) {
        throw audioError(`声音服务 ${voiceBible.provider} 不可用。`, 503);
      }
      
      const clips = [];
      
      if (voiceBible.provider === 'elevenlabs') {
        // ElevenLabs: use Text to Dialogue for multi-speaker scenes
        // Must chunk to stay under 2,000 character limit
        const sceneGroups = this.groupIntoScenes(segments, 2000);
        
        for (const scene of sceneGroups) {
          const turns = scene.map(s => ({
            text: s.text,
            voiceId: s.voice.id,
            audioTag: s.tag ? this.mapDialogueTagToAudioTag(s.tag) : undefined
          }));
          
          const result = await provider.synthesizeScene({turns, signal});
          
          // Single audio for the whole scene
          clips.push({
            sceneStart: scene[0].segmentIndex,
            sceneEnd: scene[scene.length - 1].segmentIndex,
            segments: scene.map(s => s.segmentIndex),
            ...result
          });
        }
      } else if (voiceBible.provider === 'qwen' || voiceBible.provider === 'minimax') {
        // Qwen/MiniMax: synthesize per speaker turn, then stitch
        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          
          const result = await provider.synthesizeTurn({
            text: segment.text,
            voiceId: segment.voice.id,
            signal
          });
          
          clips.push({
            segmentIndex: i,
            ...result
          });
        }
        
        // TODO: Add natural pauses between speaker changes
      } else if (voiceBible.provider === 'fish') {
        // Fish Audio Drama 3: scene-based with speaker tags
        const sceneGroups = this.groupIntoScenes(segments, 10000, 'bytes');
        
        for (const scene of sceneGroups) {
          const turns = scene.map(s => ({
            text: s.text,
            voiceId: s.voice.id,
            audioTag: s.tag ? this.mapDialogueTagToAudioTag(s.tag) : undefined
          }));
          
          const result = await provider.synthesizeScene({turns, signal});
          
          clips.push({
            sceneStart: scene[0].segmentIndex,
            sceneEnd: scene[scene.length - 1].segmentIndex,
            segments: scene.map(s => s.segmentIndex),
            ...result
          });
        }
      }
      
      // Cache clips
      for (const clip of clips) {
        const cacheKey = this.generateCacheKey(ownerId, bookId, clip, voiceBible);
        await store.putClip(cacheKey, clip.bytes);
      }
      
      return clips;
    },
    
    /**
     * Group segments into scenes respecting provider limits
     * @param {Array} segments - narration segments
     * @param {number} limit - character or byte limit
     * @param {string} unit - 'chars' or 'bytes'
     * @returns {Array} scene groups
     */
    groupIntoScenes(segments, limit, unit = 'chars') {
      const scenes = [];
      let currentScene = [];
      let currentSize = 0;
      
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const size = unit === 'bytes' ?
          Buffer.from(segment.text, 'utf8').length :
          segment.text.length;
        
        if (currentSize + size > limit && currentScene.length > 0) {
          // Start new scene
          scenes.push(currentScene);
          currentScene = [];
          currentSize = 0;
        }
        
        currentScene.push({...segment, segmentIndex: i});
        currentSize += size;
      }
      
      if (currentScene.length > 0) {
        scenes.push(currentScene);
      }
      
      return scenes;
    },
    
    /**
     * Map Chinese/English dialogue tags to audio style tags
     */
    mapDialogueTagToAudioTag(tag) {
      const mappings = {
        '低声': 'whispering',
        '大声': 'shouting',
        '轻声': 'soft',
        'angry': 'angry',
        'calm': 'calm',
        'excited': 'excited'
      };
      
      for (const [key, value] of Object.entries(mappings)) {
        if (tag.includes(key)) return value;
      }
      
      return undefined;
    },
    
    /**
     * Estimate narration cost
     * @param {string} provider - provider name
     * @param {number} characters - total characters
     * @param {number} segments - number of segments
     * @returns {object} {currency, amount, unit}
     */
    estimateCost(provider, characters, segments) {
      // Rough estimates based on provider pricing (as of 2024)
      const rates = {
        elevenlabs: {perChar: 0.00018, currency: 'USD'}, // ~$0.18 per 1K chars
        qwen: {perChar: 0.00005, currency: 'CNY'}, // ~0.05 CNY per 1K chars
        minimax: {perChar: 0.00008, currency: 'CNY'},
        fish: {perByte: 0.00003, currency: 'USD'} // Bills by UTF-8 bytes
      };
      
      const rate = rates[provider] || {perChar: 0, currency: 'USD'};
      
      if (provider === 'fish') {
        const bytes = characters * 3; // Rough UTF-8 estimate for mixed content
        return {
          currency: rate.currency,
          amount: (bytes * rate.perByte).toFixed(4),
          unit: 'bytes'
        };
      }
      
      return {
        currency: rate.currency,
        amount: (characters * rate.perChar).toFixed(4),
        unit: 'characters'
      };
    },
    
    /**
     * Generate cache key for narration clip
     */
    generateCacheKey(ownerId, bookId, clip, voiceBible) {
      return audioHash([
        'narration-v1',
        ownerId,
        bookId,
        voiceBible.id,
        clip.segmentIndex || clip.sceneStart,
        voiceBible.model
      ]);
    },
    
    /**
     * Close service and cleanup
     */
    async close() {
      // Nothing to close currently
    }
  };
}
