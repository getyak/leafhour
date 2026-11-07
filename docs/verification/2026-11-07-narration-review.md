# PR #331 review and CI repair

The original CI run 42251985142 stopped at `git diff --exit-code -- docs/copy`: new narration literals had not been exported to the checked-in inventory. The native build passed in that run; it did not validate cloud narration. The copy gate is retained and inventories are regenerated.

Review fixed source loss/duplication around dialogue tags, apostrophe parsing, missing sections, Unicode turn splitting, real split offsets, and cache collisions across content, voices and repeated split scenes. Provider contracts were checked against official docs: Qwen uses multimodal generation, `input.voice`, `output.audio.url` and WAV; MiniMax uses `t2a_v2`, nested `voice_setting`, status checks and hex decoding; ElevenLabs uses the supported HTTP dialogue model and accepts ID3 MP3 headers. Qwen orchestration uses 120-code-unit turns for the shared 4 MB store, and provider results enforce the store limit. Independent reviews identified offset and storage-size issues; both were corrected with focused regressions.

Unsafe new HTTP generation and blob-download routes were removed. These modules remain internal experiments; portal and native iOS do not instantiate them. Documentation and PR scope reflect that boundary. No paid generation, full-book processing, native release or production provider switch was performed.

Local checks:

- 66 narration/casting tests passed. The initial seven review regressions all failed against the original implementation. Later regressions cover repeated-scene cache keys, true split source offsets and bounded Qwen WAV requests.
- Web build and isolated reading-runtime build passed.
- Copy lint with pinned Vale/textlint passed; initial attempt without those executables failed and was not treated as acceptance.
- Broad concurrent test run: 4,918 total; 4,900 passed, three failed, one cancelled, 14 skipped. The startup/restart, PDF runtime and reading-guide lifecycle cases were then re-run separately. All original failed/cancelled scenarios passed on isolated recheck, including the default-instance scenario which first timed out again during the combined recheck. This is not a second full-suite pass. Current-head CI remains the merge gate.
- Other worktrees, private runtime files and the main checkout's unrelated iOS test edits are preserved. No secret values enter this record or Git.

Credentials were handled separately in ignored local configuration and the user's requested Notion credential page. Credential validation is not real audio generation acceptance. GitHub CI, merge and provider deployment remain distinct stages and must be reported from actual results.
