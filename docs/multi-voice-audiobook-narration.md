# Multi-voice narration experiment

Reviewed on 2026-11-07. This PR supplies internal parsing, voice-casting and provider adapters. It does **not** enable multi-voice narration in the running web app or iOS app. The originally proposed narration HTTP routes were removed during review: they accepted client-supplied text/casting, bypassed the existing cancellable and quota-controlled session lifecycle, and downloaded blobs without an owner-scoped record lookup. Do not reinstate them as integration examples.

## Current product behavior

Native iOS uses Apple `AVSpeechSynthesizer`, writes temporary PCM audio, and plays it with `AVAudioEngine`. `NLLanguageRecognizer` selects a system voice from the spoken text unless the reader selects an installed voice. The native app does not send narration text to these adapters. Existing web audio uses the model configured by `READER_SPEECH_MODEL` (default `gemini-3.8-flash-tts`), with Gemini credentials; dialogue scripts use DeepSeek.

## Experimental adapters

| Provider | Configuration | Contract |
| --- | --- | --- |
| ElevenLabs | `ELEVENLABS_API_KEY`; `READER_NARRATION_ELEVENLABS_MODEL` defaults to `eleven_v3` | HTTP Text to Dialogue, MP3; at most 2,000 UTF-16 code units per scene in this implementation |
| Qwen | `QWEN_API_KEY` or `DASHSCOPE_API_KEY`; `QWEN_TTS_ENDPOINT`; model defaults to `qwen3-tts-flash` | Multimodal generation HTTP endpoint, `input.voice`, `output.audio.url`; WAV; provider maximum 600 code units; orchestration uses 120-code-unit turns to keep WAV output below the shared 4 MB storage limit |
| MiniMax | `MINIMAX_API_KEY`; `MINIMAX_API_BASE` defaults to `https://api.minimax.io/v1` | `/t2a_v2`, `voice_setting.voice_id`, `output_format: hex`; checks `base_resp.status_code` before decoding MP3 |
| Fish | `FISH_API_KEY` | Unverified standalone experiment; no casting table or product integration. Do not enable for users. |

Qwen Beijing and Singapore keys are region-specific. Change the endpoint to match the key. MiniMax Group ID is not required by the current synchronous API. No provider configuration changes the existing iOS or web speech provider.

Eleven v4 Turbo is a realtime WebSocket model; this experiment uses the documented HTTP dialogue default. Changing the environment variable alone does not implement realtime streaming. A future integration must choose the matching transport rather than inventing a model ID.

Provider choice is based on configured credentials: Chinese prefers Qwen, then MiniMax, then ElevenLabs. This is configuration selection, **not** automatic retry after a failed or potentially billed request.

## Parsing and storage boundaries

Parsing uses simple quote/tag heuristics, not reliable literary speaker recognition. Every source character and offset is preserved, including quote marks, whitespace and dialogue tags; apostrophes inside English words do not create dialogue. All sections of the requested chapter are included. Chapter-level analysis cannot establish character prominence across a whole book. Unknown speakers retain the narrator voice.

Casting tables use provider voice identifiers, with per-book version metadata. A provider, detected-language or configured-model change invalidates a saved cast. Voice availability can change and must be checked against the actual account before generation. Cache identities include account, book, content version, complete selected segments, voice assignments and model. Prototype generation writes blobs and returns IDs; it does not implement production cache lookup, record authorization, backup or durable job recovery. Raw MP3/WAV concatenation is not audio stitching; return separate clips until a real decoder/encoder is integrated.

Cost figures in the prototype are illustrative historical constants, not quotes or a billing limit. No real generation or paid provider failover is performed by the tests.

## Integration work required before exposure

Use the existing audio service's owner checks, current-source verification, bounded selection, durable sessions, generation quota, cancellation, idempotency and unknown-result handling. Generate from server-owned prepared content. Persist an owner/book scoped clip record, MIME type and checksum before providing a download URL. Reuse that authorized record for downloads and exports. The native app then needs a separate remote-audio client and a reader-visible choice of system speech versus cloud processing.

## Verification

`node --test tests/narration-*.test.mjs tests/voice-casting.test.mjs` runs parser, routing, adapter and service checks. New review regressions fail on the original PR and cover source reconstruction, multiple sections, oversized Unicode turns, cache identity, official Qwen/MiniMax wire contracts and ElevenLabs model/input fields. These use mock providers and are separate from credential validity or real synthesized-audio acceptance.

Official references checked on 2026-11-07:

- [ElevenLabs HTTP dialogue](https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert)
- [ElevenLabs realtime transport](https://github.com/elevenlabs/skills/blob/main/text-to-speech/references/streaming.md)
- [Qwen HTTP synthesis](https://help.aliyun.com/zh/model-studio/qwen-tts-api)
- [Qwen voice list](https://help.aliyun.com/en/model-studio/qwen-tts-voice-list)
- [MiniMax synchronous synthesis](https://platform.minimax.io/docs/api-reference/speech-t2a-http)
