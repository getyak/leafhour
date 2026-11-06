// Test narration service integration

import {test} from 'node:test';
import assert from 'node:assert';
import {createNarrationService} from '../server/narration-service.mjs';

const mockBook = {
  bookId: 'test-book',
  contentVersion: 'v1',
  sections: [
    {
      chapterId: 'ch1',
      paragraphs: [
        {
          id: 'p1',
          original: 'He said, "Hello." She replied, "Hi."',
          translations: {
            interpretive: {text: '他说：「你好。」她回答：「嗨。」'}
          }
        },
        {
          id: 'p2',
          original: 'They walked together.',
          translations: {
            interpretive: {text: '他们一起走了。'}
          }
        }
      ]
    }
  ]
};

const mockStore = {
  voiceBibles: new Map(),
  clips: new Map(),
  async getVoiceBible(owner, bookId) {
    return this.voiceBibles.get(`${owner}:${bookId}`) || null;
  },
  async saveVoiceBible(owner, bookId, bible) {
    this.voiceBibles.set(`${owner}:${bookId}`, bible);
    return bible;
  },
  async putClip(key, bytes) {
    this.clips.set(key, bytes);
  },
  async getClip(key) {
    const clip = this.clips.get(key);
    if (!clip) throw new Error('Clip not found');
    return clip;
  }
};

const mockGetBook = async (owner, bookId) => {
  if (bookId === 'test-book') return mockBook;
  return null;
};

test('narration service: getCapabilities returns provider availability', async () => {
  const env = {
    ELEVENLABS_API_KEY: 'test-key',
    QWEN_API_KEY: 'qwen-key'
  };
  
  const service = createNarrationService({
    store: mockStore,
    getBook: mockGetBook,
    env
  });
  
  const caps = await service.getCapabilities();
  
  assert.equal(caps.providers.elevenlabs, true);
  assert.equal(caps.providers.qwen, true);
  assert.equal(caps.providers.minimax, false);
  assert.equal(caps.languages.zh, true);
  assert.equal(caps.languages.en, true);
});

test('narration service: prepareChapterNarration parses and creates voice bible', async () => {
  const env = {ELEVENLABS_API_KEY: 'test-key'};
  
  const service = createNarrationService({
    store: mockStore,
    getBook: mockGetBook,
    env
  });
  
  const result = await service.prepareChapterNarration('user1', 'test-book', 'ch1', {
    language: 'en',
    variant: 'interpretive'
  });
  
  assert.ok(result.segments);
  assert.ok(Array.isArray(result.segments));
  assert.ok(result.voiceBible);
  assert.equal(result.voiceBible.bookId, 'test-book');
  assert.equal(result.provider, 'elevenlabs');
  assert.ok(result.estimatedCost);
  
  // Check that segments have voice assignments
  const dialogueSegments = result.segments.filter(s => s.type === 'dialogue');
  assert.ok(dialogueSegments.length > 0);
  assert.ok(dialogueSegments[0].voice);
  assert.ok(dialogueSegments[0].voice.id);
});

test('narration service: prepareChapterNarration reuses existing voice bible', async () => {
  const env = {QWEN_API_KEY: 'qwen-key'};
  const freshStore = {
    voiceBibles: new Map(),
    async getVoiceBible(owner, bookId) {
      return this.voiceBibles.get(`${owner}:${bookId}`) || null;
    },
    async saveVoiceBible(owner, bookId, bible) {
      this.voiceBibles.set(`${owner}:${bookId}`, bible);
      return bible;
    }
  };
  
  const service = createNarrationService({
    store: freshStore,
    getBook: mockGetBook,
    env
  });
  
  // First prepare creates bible
  const result1 = await service.prepareChapterNarration('user1', 'test-book', 'ch1', {
    language: 'zh',
    variant: 'interpretive'
  });
  
  const bibleId1 = result1.voiceBible.id;
  
  // Second prepare reuses same bible
  const result2 = await service.prepareChapterNarration('user1', 'test-book', 'ch1', {
    language: 'zh',
    variant: 'interpretive'
  });
  
  assert.equal(result2.voiceBible.id, bibleId1);
});

test('narration service: groupIntoScenes respects character limit', () => {
  const env = {ELEVENLABS_API_KEY: 'test-key'};
  
  const service = createNarrationService({
    store: mockStore,
    getBook: mockGetBook,
    env
  });
  
  const segments = [
    {text: 'a'.repeat(1500), voice: {id: 'v1'}},
    {text: 'b'.repeat(1500), voice: {id: 'v2'}},
    {text: 'c'.repeat(100), voice: {id: 'v3'}}
  ];
  
  const scenes = service.groupIntoScenes(segments, 2000);
  
  // First segment: 1500 chars
  // Second segment would exceed 2000, so new scene
  assert.equal(scenes.length, 2);
  assert.equal(scenes[0].length, 1);
  assert.equal(scenes[1].length, 2);
});

test('narration service: groupIntoScenes respects byte limit for Fish', () => {
  const env = {FISH_API_KEY: 'test-key'};
  
  const service = createNarrationService({
    store: mockStore,
    getBook: mockGetBook,
    env
  });
  
  const segments = [
    {text: '中'.repeat(3000), voice: {id: 'v1'}}, // ~9000 bytes
    {text: '文'.repeat(500), voice: {id: 'v2'}},  // ~1500 bytes
    {text: 'a'.repeat(500), voice: {id: 'v3'}}    // 500 bytes
  ];
  
  const scenes = service.groupIntoScenes(segments, 10000, 'bytes');
  
  // First segment is ~9000 bytes, can fit second (~1500), total ~10500
  // So first two go in one scene (10,500 > limit), only first in scene 1
  assert.ok(scenes.length >= 2);
});

test('narration service: estimateCost calculates for different providers', () => {
  const env = {
    ELEVENLABS_API_KEY: 'test-key',
    QWEN_API_KEY: 'qwen-key'
  };
  
  const service = createNarrationService({
    store: mockStore,
    getBook: mockGetBook,
    env
  });
  
  const elevenCost = service.estimateCost('elevenlabs', 1000, 10);
  assert.equal(elevenCost.currency, 'USD');
  assert.ok(parseFloat(elevenCost.amount) > 0);
  
  const qwenCost = service.estimateCost('qwen', 1000, 10);
  assert.equal(qwenCost.currency, 'CNY');
  assert.ok(parseFloat(qwenCost.amount) > 0);
  
  const fishCost = service.estimateCost('fish', 1000, 10);
  assert.equal(fishCost.currency, 'USD');
  assert.equal(fishCost.unit, 'bytes');
});

test('narration service: mapDialogueTagToAudioTag converts tags', () => {
  const env = {ELEVENLABS_API_KEY: 'test-key'};
  
  const service = createNarrationService({
    store: mockStore,
    getBook: mockGetBook,
    env
  });
  
  assert.equal(service.mapDialogueTagToAudioTag('低声说'), 'whispering');
  assert.equal(service.mapDialogueTagToAudioTag('大声喊'), 'shouting');
  assert.equal(service.mapDialogueTagToAudioTag('angry tone'), 'angry');
  assert.equal(service.mapDialogueTagToAudioTag('说'), undefined);
});

test('narration service: prepareChapterNarration detects language from content', async () => {
  const env = {
    ELEVENLABS_API_KEY: 'eleven-key',
    QWEN_API_KEY: 'qwen-key'
  };
  
  const service = createNarrationService({
    store: {
      ...mockStore,
      voiceBibles: new Map()
    },
    getBook: mockGetBook,
    env
  });
  
  // Request English but content is Chinese
  const result = await service.prepareChapterNarration('user1', 'test-book', 'ch1', {
    language: 'zh', // Request Chinese translation
    variant: 'interpretive'
  });
  
  // Should detect Chinese and prefer Qwen
  assert.equal(result.language, 'zh');
  assert.equal(result.provider, 'qwen');
});

test('narration service: prepareChapterNarration throws for missing book', async () => {
  const env = {ELEVENLABS_API_KEY: 'test-key'};
  
  const service = createNarrationService({
    store: mockStore,
    getBook: mockGetBook,
    env
  });
  
  await assert.rejects(
    service.prepareChapterNarration('user1', 'nonexistent-book', 'ch1'),
    /找不到这本书/
  );
});

test('narration service: generateCacheKey creates stable keys', () => {
  const env = {ELEVENLABS_API_KEY: 'test-key'};
  
  const service = createNarrationService({
    store: mockStore,
    getBook: mockGetBook,
    env
  });
  
  const voiceBible = {
    id: 'bible123',
    model: 'eleven_multilingual_v4'
  };
  
  const clip1 = {segmentIndex: 0};
  const clip2 = {segmentIndex: 0};
  const clip3 = {segmentIndex: 1};
  
  const key1 = service.generateCacheKey('user1', 'book1', clip1, voiceBible);
  const key2 = service.generateCacheKey('user1', 'book1', clip2, voiceBible);
  const key3 = service.generateCacheKey('user1', 'book1', clip3, voiceBible);
  
  // Same segment should produce same key
  assert.equal(key1, key2);
  // Different segment should produce different key
  assert.notEqual(key1, key3);
  
  // Different user should produce different key
  const key4 = service.generateCacheKey('user2', 'book1', clip1, voiceBible);
  assert.notEqual(key1, key4);
});
