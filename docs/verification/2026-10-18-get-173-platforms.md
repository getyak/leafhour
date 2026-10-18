# GET-173: actual platform typography acceptance

This adds a remote anonymous acceptance harness, not a new product font or rendering mockup. The scoped workflow runs installed Chrome on standard Ubuntu24.04 and Windows2025 hosted runners. It checks the exact PR head and records actual OS/image/browser versions. No system font installation, paid device service, credentials, user records or provider calls are used. Source development remains on macOS; local user browsers are never driven by this script.

The actual home, authored Chinese home, library and source reader run through `createReaderServer` with isolated temporary data and all providers disabled. The cold test withholds the font request, observes fallback glyphs on the actual hero, captures it, then releases the request and captures loaded text. This is a controlled delayed-font condition, not a natural-network performance benchmark. Actual browser font response bytes must match source SHA256. `CSS.getPlatformFontsForNode` records real glyph usage, custom status and PostScript names on direct text nodes. An inherited span isolates the actual public Alice title apostrophe for glyph/width inspection; original strings remain unchanged. The reader citation uses the actual public source package's stable passage ID and content version, then checks that passage's visible original italic glyphs.

Machine assertions cannot judge CJK serif quality, mixed-script baseline harmony or visual resemblance across operating systems. Every screenshot and stock-font report must be reviewed before claiming those criteria. Windows Server2025 proves that environment, not all Windows desktop installations. The workflow keeps at most five anonymous PNGs, stock font inventory and one receipt per OS for three days; runtime records and browser profiles are excluded from artifacts.

## Current acceptance boundary

No remote workflow has run at authoring time. Only JavaScript syntax was checked locally. Windows/Linux results, screenshots and human assessment will be added after the exact-head workflow runs. Android still needs an actual official SDK environment and stock browser; a desktop390px viewport does not satisfy it. GET-173 remains In Progress until all required environments and visual criteria have evidence.

## Official interfaces

- [Chrome actual glyph usage](https://chromedevtools.github.io/devtools-protocol/tot/CSS/#method-getPlatformFontsForNode)
- [Chrome network response bodies](https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-getResponseBody)
- [Chrome request interception](https://chromedevtools.github.io/devtools-protocol/tot/Fetch/#method-continueRequest)
- [Node22 built-in WebSocket](https://nodejs.org/docs/latest-v22.x/api/globals.html#class-websocket)
- [Ubuntu24.04 runner inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)
- [Windows2025 runner inventory](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md)
- [Bounded artifact retention](https://github.com/actions/upload-artifact#retention-period)
