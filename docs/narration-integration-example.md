# Narration Integration Example

This document shows how to integrate multi-voice narration into the reader interface.

## Frontend Integration

### 1. Add Narration Button

```javascript
// In reader-audio.js or similar

async function prepareChapterNarration(bookId, chapterId) {
  const response = await fetch(`/api/library/books/${bookId}/audio/narration/prepare`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      chapterId,
      options: {
        language: 'zh', // or 'en', detected from content
        variant: 'interpretive' // or 'literal'
      }
    })
  });
  
  return response.json();
}

async function generateNarration(bookId, segments, voiceBible) {
  const response = await fetch(`/api/library/books/${bookId}/audio/narration/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      segments,
      voiceBible
    })
  });
  
  return response.json();
}

function playNarrationClip(bookId, clipId) {
  const audio = new Audio(`/api/library/books/${bookId}/audio/narration/clips/${clipId}`);
  audio.play();
  return audio;
}
```

### 2. Chapter Controls

```html
<div class="chapter-controls">
  <button class="narration-btn" data-action="prepare-narration">
    🎙️ 听这一章（多声部）
  </button>
</div>
```

### 3. Voice Preview (Optional)

Before generation, show the cast list:

```javascript
function displayVoiceCast(voiceBible) {
  const characters = Object.entries(voiceBible.assignments)
    .filter(([speaker, voice]) => voice.role === 'character')
    .map(([speaker, voice]) => `
      <div class="character-voice">
        <strong>${speaker}</strong>: ${voice.name}
      </div>
    `);
  
  return `
    <div class="voice-cast">
      <h3>角色配音</h3>
      <div>旁白: ${voiceBible.assignments.narrator.name}</div>
      ${characters.join('')}
      <div class="cost-estimate">
        预计费用: ${voiceBible.estimatedCost.currency} ${voiceBible.estimatedCost.amount}
      </div>
    </div>
  `;
}
```

## Server Integration

### Add to server/server.mjs

```javascript
import {createNarrationService} from './narration-service.mjs';
import {createAudioStore} from './audio-store.mjs';

// After creating audio service
const audioStore = await createAudioStore({dataDir});
const narrationService = createNarrationService({
  store: audioStore,
  getBook: libraryService.getBook.bind(libraryService),
  env: process.env
});

// Pass to audio routes
const audioRoutes = createAudioRoutes({
  audio: audioService,
  library: libraryService,
  narration: narrationService
});
```

## UX Flow

### Preparation Phase

1. User clicks "听这一章（多声部）"
2. Show loading: "正在分析章节..."
3. Display voice cast preview
4. Show estimated cost
5. User confirms: "开始生成"

### Generation Phase

1. Call `/narration/generate`
2. Show progress: "正在生成第 1/10 段..."
3. Poll or use WebSocket for status updates
4. Enable play as clips complete

### Playback Phase

1. Play clips in order
2. Highlight current segment
3. Allow skip forward/back by segment
4. Show speaker name during dialogue
5. Save playback position

## Mobile Considerations

### iOS/Android

For mobile apps, download narration clips and play natively:

```swift
// iOS example
func downloadNarrationClip(bookId: String, clipId: String) async throws -> URL {
    let url = URL(string: "https://leafhour.com/api/library/books/\(bookId)/audio/narration/clips/\(clipId)")!
    let (localURL, _) = try await URLSession.shared.download(from: url)
    return localURL
}

func playNarration(localURL: URL) {
    let player = AVPlayer(url: localURL)
    player.play()
}
```

## Caching Strategy

### Web

```javascript
// Cache clips in IndexedDB
async function cacheNarrationClip(bookId, clipId, blob) {
  const db = await openDB('leafhour-narration', 1, {
    upgrade(db) {
      db.createObjectStore('clips');
    }
  });
  
  await db.put('clips', blob, `${bookId}:${clipId}`);
}

async function getCachedClip(bookId, clipId) {
  const db = await openDB('leafhour-narration', 1);
  return db.get('clips', `${bookId}:${clipId}`);
}
```

### Mobile

Use native file caching with book/chapter/segment structure:

```
Library/Caches/narration/
  └── book-id/
      └── chapter-id/
          ├── segment-0.mp3
          ├── segment-1.mp3
          └── voice-bible.json
```

## Error Handling

### Insufficient Credits

```javascript
try {
  await generateNarration(bookId, segments, voiceBible);
} catch (error) {
  if (error.code === 'insufficient_credits') {
    showErrorDialog({
      title: '额度不足',
      message: `${voiceBible.provider} 额度已用完。请检查账户配额或切换提供商。`,
      actions: ['检查配额', '取消']
    });
  }
}
```

### Rate Limiting

```javascript
if (error.code === 'rate_limited') {
  showErrorDialog({
    title: '请求过于频繁',
    message: '请稍后再试，或考虑分批生成。',
    retryAfter: error.retryAfter // seconds
  });
}
```

### Missing Translation

```javascript
if (error.code === 'missing_translation') {
  showDialog({
    title: '译文尚未准备好',
    message: '这一章的意译尚未完成。您可以改听原文，或等待翻译完成。',
    actions: [
      {label: '听原文', language: 'en'},
      {label: '取消'}
    ]
  });
}
```

## Testing Integration

### Mock Narration for UI Tests

```javascript
// tests/reader-narration-ui.test.mjs
import {test} from 'node:test';
import assert from 'node:assert';

test('narration button appears after chapter load', async () => {
  const page = await loadReaderPage('/books/test-book/chapters/1');
  const button = await page.$('.narration-btn');
  assert.ok(button, 'Narration button should be present');
});

test('shows voice cast before generation', async () => {
  const page = await loadReaderPage('/books/test-book/chapters/1');
  await page.click('.narration-btn');
  
  const cast = await page.$('.voice-cast');
  assert.ok(cast, 'Voice cast preview should appear');
  
  const narrator = await cast.$eval('.narrator', el => el.textContent);
  assert.ok(narrator.includes('旁白'), 'Should show narrator');
});
```

## Accessibility

### Screen Reader Support

```html
<button 
  class="narration-btn" 
  aria-label="听这一章（多声部朗读）"
  aria-describedby="narration-description">
  🎙️ 听这一章
</button>

<div id="narration-description" class="sr-only">
  使用多个声音朗读这一章，包括旁白和角色对话。
</div>
```

### Playback Controls

```html
<div role="group" aria-label="朗读控制">
  <button aria-label="播放">▶️</button>
  <button aria-label="暂停">⏸️</button>
  <button aria-label="上一段">⏮️</button>
  <button aria-label="下一段">⏭️</button>
  <div role="slider" aria-label="播放进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="30">
    <div class="progress-bar" style="width: 30%"></div>
  </div>
</div>
```

## Performance

### Lazy Generation

Generate only visible/nearby segments first:

```javascript
async function generateNearbySegments(allSegments, currentIndex, radius = 5) {
  const start = Math.max(0, currentIndex - radius);
  const end = Math.min(allSegments.length, currentIndex + radius + 1);
  const nearby = allSegments.slice(start, end);
  
  return generateNarration(bookId, nearby, voiceBible);
}
```

### Prefetch Next Chapter

```javascript
async function prefetchNextChapter(bookId, currentChapterId) {
  const nextChapter = await getNextChapter(currentChapterId);
  if (nextChapter) {
    // Prepare in background (don't await)
    prepareChapterNarration(bookId, nextChapter.id).catch(() => {});
  }
}
```

## Analytics

Track narration usage:

```javascript
function trackNarrationEvent(event, properties) {
  analytics.track('Narration ' + event, {
    bookId: properties.bookId,
    chapterId: properties.chapterId,
    provider: properties.provider,
    language: properties.language,
    segmentCount: properties.segmentCount,
    estimatedCost: properties.estimatedCost,
    ...properties
  });
}

// Usage
trackNarrationEvent('Prepared', {
  bookId: 'book-123',
  chapterId: 'ch-1',
  provider: 'qwen',
  language: 'zh',
  segmentCount: 42
});

trackNarrationEvent('Generated', {
  bookId: 'book-123',
  chapterId: 'ch-1',
  provider: 'qwen',
  durationMs: 3500
});

trackNarrationEvent('Playback Started', {
  bookId: 'book-123',
  chapterId: 'ch-1'
});
```
