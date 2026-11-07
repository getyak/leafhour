// Test narration provider routing and adapters

import {test} from 'node:test';
import assert from 'node:assert';
import {
  detectLanguage,
  selectProvider,
  createElevenLabsProvider,
  createQwenProvider,
  createMiniMaxProvider,
  createFishProvider
} from '../server/narration-providers.mjs';

test('detectLanguage: Chinese text', () => {
  assert.equal(detectLanguage('这是中文文本'), 'zh');
  assert.equal(detectLanguage('他走上前，低声说：「你先走。」'), 'zh');
  assert.equal(detectLanguage('混合一些English也算中文'), 'zh');
});

test('detectLanguage: English text', () => {
  assert.equal(detectLanguage('This is English text'), 'en');
  assert.equal(detectLanguage('He said quietly, "Go first."'), 'en');
});

test('detectLanguage: mixed content with majority Chinese', () => {
  const mixed = '这段文字包含了 some English words 但主要是中文。';
  assert.equal(detectLanguage(mixed), 'zh');
});

test('selectProvider: Chinese prefers Qwen', () => {
  const env = {QWEN_API_KEY: 'qwen-key'};
  assert.equal(selectProvider('zh', env), 'qwen');
});

test('selectProvider: Chinese falls back to MiniMax', () => {
  const env = {MINIMAX_API_KEY: 'minimax-key'};
  assert.equal(selectProvider('zh', env), 'minimax');
});

test('selectProvider: Chinese falls back to ElevenLabs', () => {
  const env = {ELEVENLABS_API_KEY: 'eleven-key'};
  assert.equal(selectProvider('zh', env), 'elevenlabs');
});

test('selectProvider: Chinese with no provider throws', () => {
  const env = {};
  assert.throws(
    () => selectProvider('zh', env),
    /中文语音服务尚未配置/
  );
});

test('selectProvider: English uses ElevenLabs', () => {
  const env = {ELEVENLABS_API_KEY: 'eleven-key'};
  assert.equal(selectProvider('en', env), 'elevenlabs');
});

test('selectProvider: English with no provider throws', () => {
  const env = {};
  assert.throws(
    () => selectProvider('en', env),
    /语音服务尚未配置/
  );
});

test('selectProvider: override works with valid key', () => {
  const env = {
    ELEVENLABS_API_KEY: 'eleven-key',
    QWEN_API_KEY: 'qwen-key'
  };
  assert.equal(selectProvider('zh', env, 'elevenlabs'), 'elevenlabs');
});

test('selectProvider: override fails without key', () => {
  const env = {ELEVENLABS_API_KEY: 'eleven-key'};
  assert.throws(
    () => selectProvider('zh', env, 'qwen'),
    /指定的声音服务.*未配置/
  );
});

test('createElevenLabsProvider: not available without key', () => {
  const provider = createElevenLabsProvider({env: {}});
  assert.equal(provider.available, false);
});

test('createElevenLabsProvider: available with key', () => {
  const env = {ELEVENLABS_API_KEY: 'test-key'};
  const provider = createElevenLabsProvider({env});
  assert.equal(provider.available, true);
  assert.equal(provider.provider, 'elevenlabs');
  assert.equal(provider.model, 'eleven_v3');
});

test('createElevenLabsProvider: rejects scene over 2000 chars', async () => {
  const env = {ELEVENLABS_API_KEY: 'test-key'};
  const provider = createElevenLabsProvider({env});

  const turns = [
    {text: 'a'.repeat(2001), voiceId: 'voice1'}
  ];

  await assert.rejects(
    provider.synthesizeScene({turns}),
    /超过 2,000 字符限制/
  );
});

test('createElevenLabsProvider: validates turn structure', async () => {
  const env = {ELEVENLABS_API_KEY: 'test-key'};
  const provider = createElevenLabsProvider({env});

  await assert.rejects(
    provider.synthesizeScene({turns: []}),
    /场景至少需要一轮对话/
  );
});

test('createQwenProvider: not available without key', () => {
  const provider = createQwenProvider({env: {}});
  assert.equal(provider.available, false);
});

test('createQwenProvider: available with key', () => {
  const env = {QWEN_API_KEY: 'test-key'};
  const provider = createQwenProvider({env});
  assert.equal(provider.available, true);
  assert.equal(provider.provider, 'qwen');
  assert.equal(provider.model, 'qwen3-tts-flash');
});

test('createQwenProvider: rejects text over 600 chars', async () => {
  const env = {QWEN_API_KEY: 'test-key'};
  const provider = createQwenProvider({env});

  await assert.rejects(
    provider.synthesizeTurn({text: 'a'.repeat(601), voiceId: 'voice1'}),
    /超过 600 字符/
  );
});

test('createMiniMaxProvider: requires key, group ID is optional', () => {
  assert.equal(createMiniMaxProvider({env: {}}).available, false);
  assert.equal(createMiniMaxProvider({env: {MINIMAX_API_KEY: 'key'}}).available, true);
  assert.equal(createMiniMaxProvider({env: {MINIMAX_GROUP_ID: 'group'}}).available, false);

  const env = {MINIMAX_API_KEY: 'key', MINIMAX_GROUP_ID: 'group'};
  assert.equal(createMiniMaxProvider({env}).available, true);
});

test('createMiniMaxProvider: has correct model', () => {
  const env = {MINIMAX_API_KEY: 'key', MINIMAX_GROUP_ID: 'group'};
  const provider = createMiniMaxProvider({env});
  assert.equal(provider.model, 'speech-2.8-hd');
});

test('createFishProvider: not available without key', () => {
  const provider = createFishProvider({env: {}});
  assert.equal(provider.available, false);
});

test('createFishProvider: available with key and marked experimental', () => {
  const env = {FISH_API_KEY: 'test-key'};
  const provider = createFishProvider({env});
  assert.equal(provider.available, true);
  assert.equal(provider.experimental, true);
  assert.equal(provider.provider, 'fish');
  assert.equal(provider.model, 'drama-3');
});

test('createFishProvider: validates scene structure', async () => {
  const env = {FISH_API_KEY: 'test-key'};
  const provider = createFishProvider({env});

  await assert.rejects(
    provider.synthesizeScene({turns: []}),
    /场景至少需要一轮对话/
  );
});

test('createFishProvider: builds correct speaker tags', async () => {
  const env = {FISH_API_KEY: 'test-key'};
  let capturedRequest = null;

  const mockFetcher = async (url, options) => {
    capturedRequest = JSON.parse(options.body);
    throw new Error('test-abort'); // Abort early
  };

  const provider = createFishProvider({env, fetcher: mockFetcher});

  const turns = [
    {text: 'First line', voiceId: 'voice1'},
    {text: 'Second line', voiceId: 'voice2'},
    {text: 'Third line', voiceId: 'voice1'}
  ];

  try {
    await provider.synthesizeScene({turns});
  } catch (e) {
    // Expected to abort
  }

  assert.ok(capturedRequest);
  assert.ok(capturedRequest.text.includes('<|speaker:0|>'));
  assert.ok(capturedRequest.text.includes('<|speaker:1|>'));
  assert.deepEqual(capturedRequest.reference_id, ['voice1', 'voice2']);
  assert.equal(capturedRequest.model, 'drama-3');
});
