# Lazy reading entry and direct reading/listening actions

The user requested faster/lazy reader entry; no empty translation region while listening; an on/off choice when actual translation exists; an easy way back to the current audio position after browsing away; chapter-only left/right controls; and an explicit one-tap AI quote action after long press, retaining optional drag.

This supersedes the earlier blanket removal of the return-to-audio affordance: expose a quiet 44-point locate icon only when browsing/selection suspended following, not a persistent text banner. Locating returns to the actual current sentence/layer/chapter and resumes follow without restarting audio, changing speed or generating model output. Explicit locate may clear selection; ordinary speech callbacks must not move native selection.

Reader entry displays the saved/current source promptly, reusing bounded rendering and verified indexes where safe. Investigate and measure current opening first. Do not await unrelated whole-book work or network synchronization before presenting an authorized local reading copy. Defer full resource/integrity/sync work safely; never claim a full integrity pass/available-offline result when only stat/cache checks ran. Replacements, corruption, scope changes and late background results must invalidate reuse and cannot change another book/account or overwrite newer user progress/notes. Cloud position conflicts retain explicit resolution. No real user data or paid-model call is used for acceptance.

Listening only shows its comparison region when the selected actual layer has a matching comparison text. No missing-translation caption, divider, empty panel or inactive comparison button should consume space. Existing global comparison choice persists; when text exists it can be enabled/disabled, with no generation or language substitution. Keep transport balanced/centered when its comparison slot is absent.

Remove previous/next page buttons from the reading transport; swipe/tap page gestures remain. Left/right primary transport controls mean previous/next chapter in reading and listening, with accurate boundaries. Idle navigation browses without autoplay; paused audio chapter navigation stays paused; playing audio continues into the selected playable chapter. Retain stable source positions and background/lock-screen safety.

Long-press selection exposes a visible AI 引用 button in the compact bottom selection actions. Tap opens the existing attributed Chat without sending a question/model call. Drag remains optional. Source/translation provenance, exact immutable quote/retry context, native handles/copy and keyboard/VoiceOver reachability remain. Copy must not frame drag as required.

Use the current public checkout, preserve unrelated artifacts, run affected checks and independent review, consolidate push/PR, merge normally after CI and track the existing exact-source production/TestFlight chain. Physical acceptance stays separate.
