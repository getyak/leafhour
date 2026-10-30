# GET-341 iOS page taps and reading space

The current reader routes every short tap to chrome and reserves at least 64pt above and 124pt below the source before native safe areas. Actual measured controls can be shorter than these blanket reserves.

In paged mode, short taps in the left/right 30% of the body turn backward/forward through the existing source-anchored navigation. The middle 40% keeps toolbar disclosure. The top/bottom 44pt strips retain chrome disclosure. Scrolling mode retains its current behavior. Native selection, long press, multiple taps, controls, links, in-flight restoration and VoiceOver take priority. PDF taps use PDFKit page navigation, preserving its native swipe and zoom handling.

Use actual chrome measurements plus 8pt separation, with a 52pt minimum, rather than the portrait 100pt dock floor and 16/24pt extra padding. Safe areas remain supplied once by the containing SwiftUI view. Insets stay stable as chrome sleeps/wakes. System type and actual resized chrome can still grow the measured margins. Keep source-line pagination, image slicing and persisted source anchors unchanged.

Alternatives: reflow every time chrome sleeps would recover more space but change page geometry during ordinary disclosure; an overlay over source would hide readable lines. The chosen measured, stable margins reduce padding while keeping current source-position guarantees. This is an implementation choice under the existing autonomous task authorization.

Acceptance: real edge taps change actual source/screens and reverse correctly, center taps preserve it; native selection/Copy/link/long press do not turn; boundaries, reflow, tall images and cold restore retain source identity. Existing accessibility audits and GET-328/317 incomplete acceptance remain separate. No account/provider calls are needed for synthetic native acceptance.
