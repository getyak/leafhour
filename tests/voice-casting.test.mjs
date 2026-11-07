// Test voice casting system

import {test} from 'node:test';
import assert from 'node:assert';
import {
  createVoiceBible,
  getVoiceForSegment,
  validateVoiceBible
} from '../server/voice-casting.mjs';

test('createVoiceBible: assigns narrator voice', () => {
  const book = {
    bookId: 'book1',
    contentVersion: 'v1'
  };

  const segments = [
    {type: 'narration', text: 'Some narration'}
  ];

  const stats = new Map();

  const bible = createVoiceBible(book, segments, stats, 'elevenlabs', 'en');

  assert.ok(bible.assignments.narrator);
  assert.equal(bible.assignments.narrator.role, 'narrator');
  assert.equal(bible.provider, 'elevenlabs');
  assert.equal(bible.language, 'en');
});

test('createVoiceBible: assigns unique voices to major characters', () => {
  const book = {
    bookId: 'book1',
    contentVersion: 'v1'
  };

  const segments = [
    {type: 'dialogue', speaker: 'Alice', text: 'Line 1'},
    {type: 'dialogue', speaker: 'Alice', text: 'Line 2'},
    {type: 'dialogue', speaker: 'Alice', text: 'Line 3'},
    {type: 'dialogue', speaker: 'Bob', text: 'Line 1'},
    {type: 'dialogue', speaker: 'Bob', text: 'Line 2'},
    {type: 'dialogue', speaker: 'Bob', text: 'Line 3'}
  ];

  const stats = new Map([
    ['Alice', {lineCount: 3, characterCount: 18, firstAppearance: 0}],
    ['Bob', {lineCount: 3, characterCount: 18, firstAppearance: 3}]
  ]);

  const bible = createVoiceBible(book, segments, stats, 'elevenlabs', 'en');

  assert.ok(bible.assignments.Alice);
  assert.ok(bible.assignments.Bob);
  assert.notEqual(bible.assignments.Alice.id, bible.assignments.Bob.id);
  assert.equal(bible.assignments.Alice.role, 'character');
  assert.equal(bible.assignments.Bob.role, 'character');
});

test('createVoiceBible: minor characters use gender defaults', () => {
  const book = {
    bookId: 'book1',
    contentVersion: 'v1'
  };

  const segments = [
    {type: 'dialogue', speaker: '一个路人', text: '他说了一句话。'}
  ];

  const stats = new Map([
    ['一个路人', {lineCount: 1, characterCount: 10, firstAppearance: 0}]
  ]);

  const bible = createVoiceBible(book, segments, stats, 'qwen', 'zh');

  assert.ok(bible.assignments['一个路人']);
  // Should use default voice, not unique character voice
  const voice = bible.assignments['一个路人'];
  assert.ok(voice.role === 'male_default' || voice.role === 'female_default' || voice.role === 'narrator');
});

test('createVoiceBible: Chinese provider selection', () => {
  const book = {bookId: 'book1', contentVersion: 'v1'};
  const segments = [];
  const stats = new Map();

  const qwenBible = createVoiceBible(book, segments, stats, 'qwen', 'zh');
  assert.equal(qwenBible.model, 'qwen3-tts-flash');

  const minimaxBible = createVoiceBible(book, segments, stats, 'minimax', 'zh');
  assert.equal(minimaxBible.model, 'speech-2.8-hd');
});

test('getVoiceForSegment: narration uses narrator voice', () => {
  const voiceBible = {
    assignments: {
      narrator: {id: 'narrator_voice', name: 'Narrator', role: 'narrator'}
    }
  };

  const segment = {
    type: 'narration',
    text: 'Some narration'
  };

  const voice = getVoiceForSegment(segment, voiceBible);

  assert.equal(voice.id, 'narrator_voice');
  assert.equal(voice.role, 'narrator');
});

test('getVoiceForSegment: dialogue uses assigned character voice', () => {
  const voiceBible = {
    assignments: {
      narrator: {id: 'narrator_voice', name: 'Narrator', role: 'narrator'},
      Alice: {id: 'alice_voice', name: 'Alice Voice', role: 'character'}
    }
  };

  const segment = {
    type: 'dialogue',
    speaker: 'Alice',
    text: 'Hello'
  };

  const voice = getVoiceForSegment(segment, voiceBible);

  assert.equal(voice.id, 'alice_voice');
  assert.equal(voice.role, 'character');
});

test('getVoiceForSegment: unknown speaker falls back to narrator', () => {
  const voiceBible = {
    assignments: {
      narrator: {id: 'narrator_voice', name: 'Narrator', role: 'narrator'}
    }
  };

  const segment = {
    type: 'dialogue',
    speaker: 'unknown',
    text: 'Mystery line'
  };

  const voice = getVoiceForSegment(segment, voiceBible);

  assert.equal(voice.id, 'narrator_voice');
});

test('getVoiceForSegment: unassigned speaker falls back to narrator', () => {
  const voiceBible = {
    assignments: {
      narrator: {id: 'narrator_voice', name: 'Narrator', role: 'narrator'},
      Alice: {id: 'alice_voice', name: 'Alice', role: 'character'}
    }
  };

  const segment = {
    type: 'dialogue',
    speaker: 'Bob', // Not in assignments
    text: 'Hi'
  };

  const voice = getVoiceForSegment(segment, voiceBible);

  assert.equal(voice.id, 'narrator_voice');
});

test('validateVoiceBible: valid bible passes', () => {
  const voiceBible = {
    bookId: 'book1',
    contentVersion: 'v1'
  };

  const book = {
    bookId: 'book1',
    contentVersion: 'v1'
  };

  assert.equal(validateVoiceBible(voiceBible, book), true);
});

test('validateVoiceBible: mismatched version fails', () => {
  const voiceBible = {
    bookId: 'book1',
    contentVersion: 'v1'
  };

  const book = {
    bookId: 'book1',
    contentVersion: 'v2'
  };

  assert.equal(validateVoiceBible(voiceBible, book), false);
});

test('validateVoiceBible: mismatched book fails', () => {
  const voiceBible = {
    bookId: 'book1',
    contentVersion: 'v1'
  };

  const book = {
    bookId: 'book2',
    contentVersion: 'v1'
  };

  assert.equal(validateVoiceBible(voiceBible, book), false);
});

test('validateVoiceBible: null inputs fail safely', () => {
  assert.equal(validateVoiceBible(null, {bookId: 'b1', contentVersion: 'v1'}), false);
  assert.equal(validateVoiceBible({bookId: 'b1', contentVersion: 'v1'}, null), false);
  assert.equal(validateVoiceBible(null, null), false);
});
