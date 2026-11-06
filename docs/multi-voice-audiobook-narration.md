# Multi-Voice Audiobook Narration

This document describes the multi-voice audiobook narration feature for Leafhour, which provides natural-sounding audiobook experiences with distinct character voices, intelligent dialogue attribution, and language-optimized TTS providers.

## Overview

The narration system transforms books into multi-voice audiobooks by:

1. **Parsing** books into narration and dialogue segments
2. **Casting** stable voices to characters based on their prominence
3. **Routing** to language-appropriate TTS providers
4. **Synthesizing** audio with scene-level coherence
5. **Caching** generated audio for efficient playback

## Architecture

### Core Modules

- **narration-parser.mjs**: Parses books into narration vs dialogue segments
- **voice-casting.mjs**: Assigns stable voices to characters
- **narration-providers.mjs**: Multi-provider TTS adapters and language routing
- **narration-service.mjs**: Orchestrates parsing, casting, and generation
- **audio-store.mjs**: Persists voice bibles and audio clips

### Language Routing

The system automatically selects TTS providers based on content language and available credentials:

| Language | Default Provider | Fallback | Notes |
|----------|-----------------|----------|-------|
| Chinese (zh) | Alibaba Qwen Audio 3.1 TTS Plus | MiniMax Speech 2.8 HD → ElevenLabs | High-quality Chinese narration |
| English (en) | ElevenLabs v4 with Text to Dialogue | None | Scene-level multi-speaker synthesis |
| Other | ElevenLabs v4 | None | Supports 29+ languages |

## Configuration

Add these environment variables to enable narration:

```bash
# ElevenLabs (English and other languages)
ELEVENLABS_API_KEY=sk_...

# Alibaba Qwen (Chinese, primary)
QWEN_API_KEY=sk-...

# MiniMax (Chinese, optional fallback)
MINIMAX_API_KEY=...
MINIMAX_GROUP_ID=...

# Fish Audio Drama 3 (Chinese, experimental)
FISH_API_KEY=...
```

## API Endpoints

### Get Narration Capabilities

```http
GET /api/library/books/:bookId/audio/capabilities
```

Returns available providers and supported languages.

**Response:**
```json
{
  "narration": {
    "providers": {
      "elevenlabs": true,
      "qwen": true,
      "minimax": false,
      "fish": false
    },
    "languages": {
      "zh": true,
      "en": true,
      "other": true
    }
  }
}
```

### Prepare Chapter Narration

```http
POST /api/library/books/:bookId/audio/narration/prepare
```

**Request:**
```json
{
  "chapterId": "chapter-1",
  "options": {
    "language": "zh",
    "variant": "interpretive",
    "providerOverride": null
  }
}
```

**Response:**
```json
{
  "segments": [
    {
      "type": "narration",
      "text": "他走上前，低声说：",
      "passageId": "p1",
      "voice": {
        "id": "narrator_001",
        "name": "女声旁白",
        "role": "narrator"
      }
    },
    {
      "type": "dialogue",
      "text": "你先走。",
      "speaker": "他",
      "passageId": "p1",
      "voice": {
        "id": "male_character_001",
        "name": "男声角色一",
        "role": "character"
      }
    }
  ],
  "voiceBible": {
    "id": "bible-abc123...",
    "bookId": "test-book",
    "contentVersion": "v1",
    "provider": "qwen",
    "language": "zh",
    "created": "2026-11-06T16:00:00.000Z",
    "assignments": {
      "narrator": {...},
      "他": {...},
      "她": {...}
    },
    "pronunciationDict": {},
    "globalSpeed": 1.0,
    "model": "qwen-audio-3.1-tts-plus"
  },
  "provider": "qwen",
  "language": "zh",
  "estimatedCost": {
    "currency": "CNY",
    "amount": "0.0500",
    "unit": "characters"
  }
}
```

### Generate Narration

```http
POST /api/library/books/:bookId/audio/narration/generate
```

**Request:**
```json
{
  "segments": [...],
  "voiceBible": {...}
}
```

**Response:**
```json
{
  "clips": [
    {
      "segmentIndex": 0,
      "generationId": "gen-xyz789",
      "mimeType": "audio/mpeg"
    }
  ]
}
```

### Retrieve Audio Clip

```http
GET /api/library/books/:bookId/audio/narration/clips/:clipId
```

Returns MP3 audio file.

## Voice Casting System

### Voice Roles

1. **Narrator**: Reads narration and dialogue tags (e.g., "她低声说")
2. **Character Voices**: Assigned to prominent speakers (3+ lines)
3. **Gender Defaults**: Male/female fallback for minor characters
4. **Unknown Speakers**: Fall back to narrator

### Casting Algorithm

1. Parse book to identify all speakers
2. Count lines and character count per speaker
3. Rank speakers by importance: `lineCount + characterCount / 100`
4. Assign unique character voices to top N speakers
5. Minor speakers (<3 lines) use gender-based defaults
6. Unknown speakers use narrator voice

### Voice Bible

A **voice bible** is a book-level configuration that locks in:

- Voice ID assignments for each character
- TTS provider and model version
- Pronunciation dictionary (extensible)
- Global playback speed

Voice bibles are versioned with the book's `contentVersion` to ensure consistency.

## Dialogue Parsing

The parser handles:

### Quote Detection

- **Chinese**: 「」『』
- **Western**: "" ''

### Dialogue Tag Recognition

- **Chinese verbs**: 说、道、问、答、回答、喊、叫、笑、哭、低声说、大声说、轻声说
- **English verbs**: said, asked, replied, answered, shouted, whispered, cried, laughed, yelled

### Non-Dialogue Quotes

The parser excludes from dialogue:

- Signs and titles: "The sign read 'Exit'"
- Inner thoughts: "He thought 'I should leave'"
- Very short quotes (≤3 characters)

### Example Parsing

**Input:**
```
他走上前，低声说：「你先走。」她点了点头。
```

**Segments:**
```javascript
[
  {type: 'narration', text: '他走上前，低声说：'},
  {type: 'dialogue', text: '你先走。', speaker: '他', tag: '低声说'},
  {type: 'narration', text: '她点了点头。'}
]
```

## Provider Details

### ElevenLabs (English + Others)

- **Model**: `eleven_multilingual_v4`
- **API**: Text to Dialogue (scene-based)
- **Limit**: 2,000 characters per scene
- **Output**: MP3
- **Features**: Natural conversation flow, audio tags ([whispering], [angry])

**Example Scene Request:**
```json
{
  "model_id": "eleven_multilingual_v4",
  "inputs": [
    {
      "text": "Hello there.",
      "voice_id": "cgSgspJ2msm6clMCkdW9",
      "audio_tag": "whispering"
    },
    {
      "text": "Hi! How are you?",
      "voice_id": "pqHfZKP75CvOlQylNhV4"
    }
  ]
}
```

### Alibaba Qwen Audio 3.1 TTS Plus (Chinese)

- **Model**: `qwen-audio-3.1-tts-plus`
- **API**: Single-speaker per request (stitch with pauses)
- **Limit**: 4,000 characters per request
- **Output**: MP3 (download from returned URL)
- **Features**: High-quality Chinese pronunciation, multiple voices

**Example Request:**
```json
{
  "model": "qwen-audio-3.1-tts-plus",
  "input": {
    "text": "你好，世界！"
  },
  "parameters": {
    "voice": "narrator_001",
    "format": "mp3",
    "sample_rate": 24000
  }
}
```

### MiniMax Speech 2.8 HD (Chinese)

- **Model**: `speech-2.8-hd`
- **API**: Single-speaker per request
- **Limit**: 4,000 characters per request
- **Output**: Base64-encoded MP3
- **Features**: Natural Chinese voices, fast generation

**Example Request:**
```json
{
  "model": "speech-2.8-hd",
  "text": "这是一段测试文本。",
  "voice_id": "narrator_neutral",
  "audio_setting": {
    "format": "mp3",
    "sample_rate": 24000
  }
}
```

### Fish Audio Drama 3 (Experimental)

- **Model**: `drama-3` (exact spelling required)
- **API**: Multi-speaker scene with `<|speaker:N|>` tags
- **Limit**: 10,000 UTF-8 bytes
- **Billing**: By UTF-8 byte count
- **Features**: Reference audio support, [direction] brackets
- **Warning**: Silently falls back to `s2.1-pro` if model name is misspelled

**Example Request:**
```json
{
  "text": "<|speaker:0|>你好 [whispering] <|speaker:1|>你好吗？",
  "reference_id": ["voice1_id", "voice2_id"],
  "model": "drama-3",
  "format": "mp3",
  "sample_rate": 24000
}
```

## Scene Chunking

For providers with character limits, the service chunks long chapters into scenes:

### ElevenLabs Scenes (2,000 char limit)

```javascript
const scenes = narration.groupIntoScenes(segments, 2000, 'chars');
```

Keeps related dialogue turns together, splits at natural boundaries.

### Fish Audio Scenes (10,000 byte limit)

```javascript
const scenes = narration.groupIntoScenes(segments, 10000, 'bytes');
```

Calculates UTF-8 byte length for accurate billing.

### Chinese Provider Stitching

Qwen and MiniMax synthesize one speaker turn at a time, then stitch with 300ms pauses at speaker changes.

## Caching

Generated audio is cached by:

```
SHA-256([
  'narration-v1',
  ownerId,
  bookId,
  voiceBible.id,
  segmentIndex,
  model
])
```

- Same text + voice + model → reuse cache
- Different user → separate cache (private content)
- Content version change → invalidate cache

## Testing

Run narration tests:

```bash
node --test tests/narration-parser.test.mjs
node --test tests/voice-casting.test.mjs
node --test tests/narration-providers.test.mjs
node --test tests/narration-service.test.mjs
```

All tests use mock TTS providers; real provider tests require API keys.

## Cost Estimation

The service provides cost estimates before generation:

| Provider | Unit | Rate (approximate) |
|----------|------|-------------------|
| ElevenLabs | character | $0.00018 USD |
| Qwen | character | ¥0.00005 CNY |
| MiniMax | character | ¥0.00008 CNY |
| Fish Audio | UTF-8 byte | $0.00003 USD |

Estimates are informational; actual billing depends on the provider's current pricing.

## Limitations

### Current Version

- No pronunciation dictionary editing UI (structure exists)
- No voice preview before generation
- Stitching adds simple pauses, not crossfades
- Fish Audio Drama 3 is experimental (requires exact model name)

### Provider Constraints

- **ElevenLabs**: 2,000 char scene limit, 10,000 char monthly quota (starter)
- **Qwen**: Requires Alibaba Cloud account, China region restrictions
- **MiniMax**: Requires Group ID + API key, quota management
- **Fish Audio**: Bills by UTF-8 bytes, silent fallback risk

## Security

- API keys stored in environment variables only
- Keys never exposed to frontend or logs
- Audio clips scoped to book owner (no cross-user access)
- Cache keys include owner ID to prevent leakage

## Future Enhancements

Potential improvements (not currently implemented):

1. **Pronunciation Dictionary UI**: Edit character names, technical terms
2. **Voice Preview**: Try different voices before full generation
3. **Emotion Tags**: Map dialogue context to delivery style
4. **Crossfade Stitching**: Smooth transitions between speakers
5. **Streaming Playback**: Start playing before full chapter completes
6. **Voice Cloning**: Custom voices for main characters (ElevenLabs Voice Lab)
7. **Timestamp Alignment**: Word-level sync for visual highlighting

## Migration Path

Existing audio infrastructure (`audio-service.mjs`, `audio-routes.mjs`) remains unchanged. Narration is a parallel system sharing the same storage and authentication.

Books continue to work with existing single-voice TTS. Narration is opt-in per chapter.

## References

- [ElevenLabs Text to Dialogue API](https://elevenlabs.io/docs/api-reference/text-to-dialogue)
- [Alibaba Qwen Audio API](https://help.aliyun.com/zh/model-studio/developer-reference/qwen-audio-api)
- [MiniMax Speech API](https://www.minimaxi.com/document/guides/speech-model/pro-api)
- [Fish Audio Drama 3](https://fish.audio/docs/text-to-speech)
