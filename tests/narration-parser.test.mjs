// Test narration parser: dialogue vs narration splitting

import {test} from 'node:test';
import assert from 'node:assert';
import {
  parsePassage,
  parseChapter,
  analyzeCharacters,
  isNonDialogueQuote
} from '../server/narration-parser.mjs';

test('parsePassage: Chinese dialogue with tags', () => {
  const passage = {
    id: 'p1',
    original: 'Original text',
    translations: {
      interpretive: {
        text: '他走上前，低声说：「你先走。」她点了点头。'
      }
    },
    chapterId: 'c1'
  };

  const segments = parsePassage(passage, 'zh', 'interpretive');

  assert.ok(segments.length >= 2);
  const dialogueSegments = segments.filter(s => s.type === 'dialogue');
  assert.ok(dialogueSegments.length > 0);
  assert.equal(dialogueSegments[0].text, '「你先走。」');
});

test('parsePassage: Western quotes', () => {
  const passage = {
    id: 'p2',
    original: 'He approached and said quietly, "Go first." She nodded.',
    translations: {},
    chapterId: 'c1'
  };

  const segments = parsePassage(passage, 'en', 'interpretive');

  const dialogueSegments = segments.filter(s => s.type === 'dialogue');
  assert.ok(dialogueSegments.length > 0);
  assert.equal(dialogueSegments[0].text, '"Go first."');
  assert.ok(dialogueSegments[0].speaker);
});

test('parsePassage: no dialogue returns all narration', () => {
  const passage = {
    id: 'p3',
    original: 'This is just narration without any dialogue.',
    translations: {},
    chapterId: 'c1'
  };

  const segments = parsePassage(passage, 'en', 'interpretive');

  assert.equal(segments.length, 1);
  assert.equal(segments[0].type, 'narration');
  assert.equal(segments[0].text, 'This is just narration without any dialogue.');
});

test('parsePassage: dialogue tag extraction', () => {
  const passage = {
    id: 'p4',
    original: '',
    translations: {
      interpretive: {
        text: '张三问：「你去哪里？」李四回答：「去图书馆。」'
      }
    },
    chapterId: 'c1'
  };

  const segments = parsePassage(passage, 'zh', 'interpretive');

  const dialogueSegments = segments.filter(s => s.type === 'dialogue');
  assert.equal(dialogueSegments.length, 2);
  assert.ok(dialogueSegments[0].speaker);
  assert.ok(dialogueSegments[1].speaker);
  // Speakers should be different
  assert.notEqual(dialogueSegments[0].speaker, dialogueSegments[1].speaker);
});

test('isNonDialogueQuote: detects signs and titles', () => {
  assert.equal(isNonDialogueQuote('The sign read "Exit"', 'Exit'), true);
  assert.equal(isNonDialogueQuote('标题是「前言」', '前言'), true);
  assert.equal(isNonDialogueQuote('He thought "I should leave"', 'I should leave'), true);
  assert.equal(isNonDialogueQuote('She said "Hello"', 'Hello'), false);
});

test('isNonDialogueQuote: very short quotes are not dialogue', () => {
  assert.equal(isNonDialogueQuote('He said "OK"', 'OK'), true);
  assert.equal(isNonDialogueQuote('He said "Yes"', 'Yes'), true);
});

test('analyzeCharacters: ranks by line count', () => {
  const segments = [
    {type: 'dialogue', speaker: 'Alice', text: 'First line'},
    {type: 'narration', text: 'Some narration'},
    {type: 'dialogue', speaker: 'Bob', text: 'Bob speaks'},
    {type: 'dialogue', speaker: 'Alice', text: 'Alice again'},
    {type: 'dialogue', speaker: 'Alice', text: 'Alice third time'}
  ];

  const stats = analyzeCharacters(segments);

  assert.equal(stats.get('Alice').lineCount, 3);
  assert.equal(stats.get('Bob').lineCount, 1);
  assert.ok(stats.get('Alice').characterCount > stats.get('Bob').characterCount);
});

test('analyzeCharacters: ignores unknown speakers', () => {
  const segments = [
    {type: 'dialogue', speaker: 'unknown', text: 'Mystery speaker'},
    {type: 'dialogue', speaker: 'Alice', text: 'Alice speaks'}
  ];

  const stats = analyzeCharacters(segments);

  assert.equal(stats.has('unknown'), false);
  assert.equal(stats.has('Alice'), true);
});

test('parseChapter: rejects missing chapter', () => {
  const book = {
    sections: [
      {chapterId: 'c1', paragraphs: []}
    ]
  };

  assert.throws(
    () => parseChapter(book, 'c2', 'zh', 'interpretive'),
    /找不到这一章/
  );
});

test('parseChapter: processes multiple paragraphs', () => {
  const book = {
    sections: [
      {
        chapterId: 'c1',
        paragraphs: [
          {
            id: 'p1',
            original: 'First paragraph.',
            translations: {interpretive: {text: '第一段。'}}
          },
          {
            id: 'p2',
            original: 'Second paragraph.',
            translations: {interpretive: {text: '第二段。'}}
          }
        ]
      }
    ]
  };

  const segments = parseChapter(book, 'c1', 'zh', 'interpretive');

  assert.ok(segments.length >= 2);
  const passageIds = [...new Set(segments.map(s => s.passageId))];
  assert.equal(passageIds.length, 2);
  assert.ok(passageIds.includes('p1'));
  assert.ok(passageIds.includes('p2'));
});
