// Multi-voice audiobook TTS providers: ElevenLabs, Alibaba Qwen, MiniMax, Fish Audio
// Language routing: Chinese → Qwen/MiniMax, English/others → ElevenLabs

import {audioError} from './audio-content.mjs';

/**
 * Detect content language from text
 * @param {string} text - text sample
 * @returns {string} 'zh'|'en'|'other'
 */
export function detectLanguage(text) {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const totalChars = text.length;

  if (chineseChars / totalChars > 0.3) return 'zh';
  if (/[a-zA-Z]/.test(text)) return 'en';
  return 'other';
}

/**
 * Select TTS provider based on language and available credentials
 * @param {string} language - 'zh'|'en'|'other'
 * @param {object} env - environment variables
 * @param {string} override - optional provider override
 * @returns {string} 'elevenlabs'|'qwen'|'minimax'|'fish'
 */
export function selectProvider(language, env = process.env, override = null) {
  if (override) {
    // Validate override provider is configured
    if (override === 'elevenlabs' && env.ELEVENLABS_API_KEY) return 'elevenlabs';
    if (override === 'qwen' && (env.QWEN_API_KEY || env.DASHSCOPE_API_KEY)) return 'qwen';
    if (override === 'minimax' && env.MINIMAX_API_KEY) return 'minimax';
    if (override === 'fish' && env.FISH_API_KEY) return 'fish';
    throw audioError(`指定的声音服务 ${override} 未配置。`, 503, 'provider_not_configured');
  }

  if (language === 'zh') {
    // Chinese: prefer Qwen → MiniMax → ElevenLabs (fallback)
    if ((env.QWEN_API_KEY || env.DASHSCOPE_API_KEY)) return 'qwen';
    if (env.MINIMAX_API_KEY) return 'minimax';
    if (env.ELEVENLABS_API_KEY) return 'elevenlabs'; // Fallback
    throw audioError('中文语音服务尚未配置，请填写 QWEN_API_KEY 或 MINIMAX_API_KEY。', 503, 'no_chinese_provider');
  }

  // English and other languages: ElevenLabs
  if (env.ELEVENLABS_API_KEY) return 'elevenlabs';
  throw audioError('语音服务尚未配置，请填写 ELEVENLABS_API_KEY。', 503, 'no_english_provider');
}

/**
 * ElevenLabs Text to Dialogue API adapter
 * Official docs: https://elevenlabs.io/docs/api-reference/text-to-dialogue
 * Constraint: total inputs[].text <= 2,000 characters per request
 */
export function createElevenLabsProvider({env = process.env, fetcher = fetch} = {}) {
  const key = env.ELEVENLABS_API_KEY;
  const model = env.READER_NARRATION_ELEVENLABS_MODEL || 'eleven_v3'; // HTTP dialogue; realtime v4 Turbo requires a WebSocket adapter.

  return {
    available: !!key,
    model,
    provider: 'elevenlabs',

    async synthesizeScene({turns, signal}) {
      if (!key) {
        throw audioError('ElevenLabs API key 未配置。', 503, 'not_configured');
      }

      if (!Array.isArray(turns) || turns.length === 0) {
        throw audioError('场景至少需要一轮对话。');
      }

      // Validate 2,000 char limit across all turns
      const totalChars = turns.reduce((sum, t) => sum + (t.text?.length || 0), 0);
      if (totalChars > 2000) {
        throw audioError('ElevenLabs 场景文本超过 2,000 字符限制，请分段处理。', 413, 'scene_too_long');
      }

      const inputs = turns.map(t => ({
        text: t.text,
        voice_id: t.voiceId
      }));

      const payload = {
        model_id: model,
        inputs
      };

      const combined = signal ?
        AbortSignal.any([signal, AbortSignal.timeout(60000)]) :
        AbortSignal.timeout(60000);

      combined.throwIfAborted();

      let response;
      try {
        response = await fetcher('https://api.elevenlabs.io/v1/text-to-dialogue', {
          method: 'POST',
          headers: {
            'xi-api-key': key,
            'Content-Type': 'application/json'
          },
          signal: combined,
          body: JSON.stringify(payload)
        });
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        throw audioError('ElevenLabs 连接失败或超时。', 502, 'provider_unavailable');
      }

      if (!response.ok) {
        const status = response.status;
        await response.body?.cancel();

        if (status === 401 || status === 403) {
          throw audioError('ElevenLabs API key 无效。', 401, 'invalid_credentials');
        }
        if (status === 402) {
          throw audioError('ElevenLabs 额度不足。', 402, 'insufficient_credits');
        }
        if (status === 429) {
          throw audioError('ElevenLabs 请求过于频繁。', 429, 'rate_limited');
        }

        throw audioError('ElevenLabs 生成失败。', 502, 'provider_error');
      }

      // ElevenLabs returns MP3 audio
      const audioBuffer = await response.arrayBuffer();
      const bytes = Buffer.from(audioBuffer);
      if (!bytes.length || bytes.length > 4000000) throw audioError('声音文件超过存储上限，请缩短范围。', 502, 'invalid_audio');

      if (bytes.length < 100 || bytes.length > 4000000) {
        throw audioError('ElevenLabs 返回音频格式无效。', 502, 'invalid_audio');
      }

      // Validate MP3 header
      if (!(bytes.subarray(0,3).toString() === 'ID3' || bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0)) {
        throw audioError('ElevenLabs 返回的不是有效 MP3。', 502, 'invalid_audio');
      }

      return {
        bytes,
        mimeType: 'audio/mpeg',
        generationId: response.headers.get('x-generation-id') || null
      };
    }
  };
}

/**
 * Alibaba Qwen Audio 3.1 TTS Plus adapter
 * Docs: https://help.aliyun.com/zh/model-studio/developer-reference/qwen-audio-api
 */
export function createQwenProvider({env = process.env, fetcher = fetch} = {}) {
  const key = (env.QWEN_API_KEY || env.DASHSCOPE_API_KEY);
  const model = env.READER_NARRATION_QWEN_MODEL || 'qwen3-tts-flash';

  return {
    available: !!key,
    model,
    provider: 'qwen',

    async synthesizeTurn({text, voiceId, signal}) {
      if (!key) {
        throw audioError('Qwen API key 未配置。', 503, 'not_configured');
      }

      if (!text || text.length > 600) {
        throw audioError('单段文本超过 600 字符。', 413);
      }

      const payload = {model, input: {text, voice: voiceId || 'Cherry', language_type: 'Auto'}};
      const endpoint = env.QWEN_TTS_ENDPOINT || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

      const combined = signal ?
        AbortSignal.any([signal, AbortSignal.timeout(45000)]) :
        AbortSignal.timeout(45000);

      combined.throwIfAborted();

      let response;
      try {
        response = await fetcher(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json'
          },
          signal: combined,
          body: JSON.stringify(payload)
        });
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        throw audioError('Qwen 连接失败或超时。', 502, 'provider_unavailable');
      }

      if (!response.ok) {
        const status = response.status;
        await response.body?.cancel();

        if (status === 401 || status === 403) {
          throw audioError('Qwen API key 无效。', 401, 'invalid_credentials');
        }
        if (status === 429) {
          throw audioError('Qwen 请求过于频繁。', 429, 'rate_limited');
        }

        throw audioError('Qwen 生成失败。', 502, 'provider_error');
      }

      const result = await response.json();

      if (!result.output || !result.output.audio?.url) {
        throw audioError('Qwen 返回数据格式无效。', 502, 'invalid_response');
      }

      // Download the audio from the returned URL
      const audioUrl = new URL(result.output.audio.url);
      if (!['https:', 'http:'].includes(audioUrl.protocol) || !/\.oss-(?:cn-[a-z0-9-]+|ap-southeast-[0-9]+)\.aliyuncs\.com$/.test(audioUrl.hostname)) throw audioError('Qwen 音频地址无效。', 502, 'invalid_response');
      audioUrl.protocol = 'https:';
      const audioResponse = await fetcher(audioUrl.href, {signal: combined, redirect: 'error'});
      if (!audioResponse.ok) throw audioError('Qwen 音频下载失败。', 502, 'invalid_response');
      const audioBuffer = await audioResponse.arrayBuffer();
      const bytes = Buffer.from(audioBuffer);
      if (!bytes.length || bytes.length > 4000000) throw audioError('声音文件超过存储上限，请缩短范围。', 502, 'invalid_audio');

      return {
        bytes,
        mimeType: 'audio/wav',
        generationId: result.request_id || null
      };
    }
  };
}

/**
 * MiniMax Speech 2.8 HD adapter
 * Docs: https://www.minimaxi.com/document/guides/speech-model/pro-api
 */
export function createMiniMaxProvider({env = process.env, fetcher = fetch} = {}) {
  const key = env.MINIMAX_API_KEY;
  const groupId = env.MINIMAX_GROUP_ID;
  const model = 'speech-2.8-hd';

  return {
    available: !!key,
    model,
    provider: 'minimax',

    async synthesizeTurn({text, voiceId, signal}) {
      if (!key) {
        throw audioError('MiniMax API 配置不完整。', 503, 'not_configured');
      }

      if (!text || text.length > 4000) {
        throw audioError('单段文本超过 4,000 字符。', 413);
      }

      const payload = {
        model,
        text,
        voice_setting: {voice_id: voiceId || 'Chinese (Mandarin)_Warm_Bestie'},
        stream: false, output_format: 'hex',
        audio_setting: {
          format: 'mp3',
          sample_rate: 24000
        }
      };

      const combined = signal ?
        AbortSignal.any([signal, AbortSignal.timeout(45000)]) :
        AbortSignal.timeout(45000);

      combined.throwIfAborted();

      let response;
      try {
        response = await fetcher(`${env.MINIMAX_API_BASE || 'https://api.minimax.io/v1'}/t2a_v2`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json'
          },
          signal: combined,
          body: JSON.stringify(payload)
        });
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        throw audioError('MiniMax 连接失败或超时。', 502, 'provider_unavailable');
      }

      if (!response.ok) {
        const status = response.status;
        await response.body?.cancel();

        if (status === 401 || status === 403) {
          throw audioError('MiniMax API key 无效。', 401, 'invalid_credentials');
        }
        if (status === 429) {
          throw audioError('MiniMax 请求过于频繁。', 429, 'rate_limited');
        }

        throw audioError('MiniMax 生成失败。', 502, 'provider_error');
      }

      const result = await response.json();

      if (result.base_resp?.status_code !== 0 || !/^(?:[a-f0-9]{2})+$/i.test(result.data?.audio || '')) {
        throw audioError('MiniMax 返回数据格式无效。', 502, 'invalid_response');
      }

      // Audio is base64 encoded
      const bytes = Buffer.from(result.data.audio, 'hex');
      if (!bytes.length || bytes.length > 4000000) throw audioError('声音文件超过存储上限，请缩短范围。', 502, 'invalid_audio');

      return {
        bytes,
        mimeType: 'audio/mpeg',
        generationId: result.trace_id || null
      };
    }
  };
}

/**
 * Fish Audio Drama 3 adapter (experimental)
 * Docs: https://fish.audio/docs/text-to-speech
 * Bills by UTF-8 bytes; uses reference_id array + <|speaker:N|> tags
 */
export function createFishProvider({env = process.env, fetcher = fetch} = {}) {
  const key = env.FISH_API_KEY;
  const model = 'drama-3';

  return {
    available: !!key,
    model,
    provider: 'fish',
    experimental: true,

    async synthesizeScene({turns, signal}) {
      if (!key) {
        throw audioError('Fish Audio API key 未配置。', 503, 'not_configured');
      }

      if (!Array.isArray(turns) || turns.length === 0) {
        throw audioError('场景至少需要一轮对话。');
      }

      // Build Fish Audio format: <|speaker:0|> text [direction]
      const speakerMap = new Map();
      const referenceIds = [];

      turns.forEach(t => {
        if (!speakerMap.has(t.voiceId)) {
          speakerMap.set(t.voiceId, speakerMap.size);
          referenceIds.push(t.voiceId);
        }
      });

      const scriptParts = turns.map(t => {
        const speakerIndex = speakerMap.get(t.voiceId);
        const direction = t.audioTag ? ` [${t.audioTag}]` : '';
        return `<|speaker:${speakerIndex}|>${t.text}${direction}`;
      });

      const text = scriptParts.join(' ');

      // Fish bills by UTF-8 bytes
      const byteLength = Buffer.from(text, 'utf8').length;
      if (byteLength > 10000) {
        throw audioError('Fish Audio 场景文本超过 10,000 字节。', 413, 'scene_too_long');
      }

      const payload = {
        text,
        reference_id: referenceIds,
        model: 'drama-3', // Must be exact
        format: 'mp3',
        sample_rate: 24000
      };

      const combined = signal ?
        AbortSignal.any([signal, AbortSignal.timeout(60000)]) :
        AbortSignal.timeout(60000);

      combined.throwIfAborted();

      let response;
      try {
        response = await fetcher('https://api.fish.audio/v1/tts', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json'
          },
          signal: combined,
          body: JSON.stringify(payload)
        });
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        throw audioError('Fish Audio 连接失败或超时。', 502, 'provider_unavailable');
      }

      if (!response.ok) {
        const status = response.status;
        const errorText = await response.text();

        // Detect silent model fallback
        if (errorText.includes('model') || errorText.includes('drama')) {
          throw audioError('Fish Audio 模型配置错误，请确认使用 drama-3。', 400, 'invalid_model');
        }

        if (status === 401 || status === 403) {
          throw audioError('Fish Audio API key 无效。', 401, 'invalid_credentials');
        }
        if (status === 429) {
          throw audioError('Fish Audio 请求过于频繁。', 429, 'rate_limited');
        }

        throw audioError('Fish Audio 生成失败。', 502, 'provider_error');
      }

      const audioBuffer = await response.arrayBuffer();
      const bytes = Buffer.from(audioBuffer);
      if (!bytes.length || bytes.length > 4000000) throw audioError('声音文件超过存储上限，请缩短范围。', 502, 'invalid_audio');

      return {
        bytes,
        mimeType: 'audio/mpeg',
        generationId: response.headers.get('x-request-id') || null
      };
    }
  };
}

/**
 * Stitch multiple audio segments with natural pauses
 * @param {Array} audioBuffers - array of {bytes, mimeType}
 * @param {number} pauseDurationMs - pause between segments in milliseconds
 * @returns {Buffer} concatenated audio
 */
export async function stitchAudioSegments(audioBuffers) {
  if (audioBuffers.length !== 1) throw audioError('音频拼接尚未实现，请分别播放片段。', 501, 'stitching_not_supported');
  return audioBuffers[0].bytes;
}
