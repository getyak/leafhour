# Quiet reading chat implementation plan

> Historical plan, archived on 2026-10-30. GET-220 / PR #183 recovered its core behavior. PR #227 subsequently replaced the desktop overlay with a sidebar; GET-274 / PR #258 later retained that sidebar and introduced the mobile half sheet. The old workspace/network blockers below describe the October 25 session. Follow the [GET-220 evidence](../../verification/2026-10-26-get-220/README.md) and [GET-274 evidence](../../verification/2026-10-29-get-274/README.md) for the later implementation. Do not reapply the saved patch or renew pricing from this historical date.

Goal: opening AI shows one bounded conversation, leaves the reading page still, and supports outside-click dismissal without losing drafts or running work.

Design follows the user's explicit interaction requirements. Keep the existing conversation and account isolation; use a floating desktop panel instead of reserving a second reading column. On small screens retain the accessible full-screen conversation. Close transient reader tools on entry; close More before the conversation on Escape. A pointer gesture that starts inside must never dismiss on release outside. Outside dismissal must preserve the clicked target's focus.

1. Add failing interaction tests for outside dismissal, nested menu Escape, preserved drafts and running requests; then implement in `app/library-chat.mjs`.
2. Add a failing layout test, remove document reflow on chat open/close/resize, and size the floating surface in `app/reader-chat-workspace.css`. Keep mobile focus containment and completed resize persistence.
3. Reproduce paid conversation rejection with explicit `preferenceWrites`; repair both client and server allowlists, validate the boolean, and verify quote identity remains bound to the complete request.
   Investigation also reproduced the primary unbilled outage: `harness/pricing.json` expired on October 22 and generation rejects before bridge/model initialization. Verify the official current CNY upper-bound rates and refresh the seven-day reference; retain expiry and the existing 0.75 CNY request cap. Add an isolated runtime admission regression for the incident date, without model requests.
4. Verify reader entry dismisses transient selection tools. Audit adjacent surfaces against their existing outside-click and Escape contracts.
5. Run focused tests, the full suite and production build. Review the diff, then attempt the authorized branch/PR/CI/production workflow. Record environmental blockers without claiming release or real-model verification.

Workspace note: the existing checkout contains unrelated live work. Native worktree tools failed; its `.git` is read-only in this session. Edit only the files for this task and preserve all other changes. GitHub MCP authentication failed, and local git/gh checks also failed because the configured proxy is unreachable; direct network/DNS is unavailable too.
