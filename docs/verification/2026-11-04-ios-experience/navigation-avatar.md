# Navigation, elasticity and avatar implementation

Implementation scope: native iPhone only. Source changes exist in the shared task worktree; build, independent review and simulator results are recorded separately by the controller.

## Navigation and elasticity
- `RootTabPager` uses UIKit `UIPageViewController` scroll transition, so the screen tracks the finger continuously, adopts release velocity and cancels naturally. Endpoints have no neighboring page and cannot wrap. Native `UITabBar` retains selected-item semantics and explicit tap navigation.
- The pager disables only its own direct horizontal scroll view when the currently selected shelf/journal has a pushed destination. Child vertical scrolling, selection and native navigation remain independent. The shelf/journal report depth through `rootNavigationDepthChanged`.
- Native vertical `scrollBounceBehavior(.always, axes: .vertical)` is requested on shelf and avatar surfaces; journal work is coordinated with its owner. Reduce Motion removes programmatic page animation and horizontal boundary bounce. No extra accumulating offset, artificial spring or nested root vertical scroller is added.
- Tab presses arriving during a drag are retained and reconciled after native settling; tab presses during a programmatic transition reconcile to the latest binding value.

## Avatar mechanism
- Nine 256px PNGs (six Thumbs, three Shapes), 148 KiB including asset metadata, are bundled. Both styles are DiceBear CC0 artwork, verified from the official style pages. `AvatarSources.json` retains fixed non-personal seeds, original source URLs and SHA-256 hashes. `AvatarThirdPartyNotices.txt` distinguishes artwork permission from the application's license.
- Defaults are deterministic per owner. Preference keys and photo filenames use SHA-256 of the account identity; signed-out device profile is distinct. No DiceBear network request occurs in the application. The picker explicitly says this preference remains on the device.
- System PhotosPicker reads only the selected photo. ImageIO decodes an orientation-correct thumbnail, center-crops to a new 384px square bitmap, and JPEG-encodes without source EXIF/GPS. Processing runs off the main actor. Input is bounded at 25MiB, writes are atomic and use file protection. A decode/write failure keeps the prior choice and shows recovery text. Cancelled selection leaves the prior choice.
- Gallery targets are at least 74px and photo/default controls at least 44px. Selection exposes native selected trait; all preview artwork is hidden from VoiceOver to avoid duplicate announcements.

## Checks performed by implementer
- `xcrun swiftc -frontend -parse` passed for the new components and new tests.
- Asset PNG signatures and count (9) checked at acquisition; source hashes retained.
- Added `ProfileAvatarTests`: account/device isolation and relaunch; invalid preset; actual 384px photo output and removed GPS; unreadable-image recovery; all bundled resources available.
- Added `RootTabGestureUITests`: actual horizontal drags update native selected tabs in both directions; avatar choice and photo-picker reachability. These are authored, not yet claimed passing here.
- Controller's first build identified a CryptoKit digest `.first` overload; fixed by materializing its bytes before selecting the deterministic default.

## Required independent assessment
Observe actual simulator screenshots and continuous dragging, rapid alternating tab presses, vertical bottom overscroll, pushed navigation back, large text and dark mode. Physical-device haptic/120Hz, VoiceOver speech and real-user preference are unverified. No 9.5/10 acceptance score is asserted without that evidence. PhotosPicker currently center-crops; user-controlled crop framing is not implemented.

## Native tab-bar safe-area correction
The first simulator selection screenshot showed iOS 26's floating native bar drawing above the old fixed 49pt SwiftUI reservation, obscuring the lower Copy/Share buttons. Replaced the separate SwiftUI `safeAreaInset` with a UIKit root container: the pager's physical bottom is constrained to the tab bar's top, and the tab bar is fitted with `sizeThatFits` after its real window/safe-area layout. Safe-area and orientation changes repeat native fitting. No chat-specific padding was added. `RootTabLayoutTests` verifies page/bar non-overlap and the measured native height in portrait/landscape; execution and corrected screenshot acceptance remain the controller's responsibility.

The latest `/tmp/leafhour-experience-gesture-fix.log` at 23:19 reports all three selected tests passed, including actual shelf → squirrel → journal → squirrel drags. This run already incorporated the controller's removal of the competing directionless chat drag recognizer; no further root gesture change was needed for that failure.

## Keyboard boundary follow-up
The first physical-viewport correction exposed a keyboard regression in `/tmp/leafhour-experience-final.log`: the software keyboard began at y=539 while the hosted send action remained in the covered region. Added a required `pager.bottom <= view.keyboardLayoutGuide.top` constraint and reduced the preferred `pager.bottom == tabBar.top` equality to priority 999. The page now contracts to the actual system keyboard boundary while the native tab bar stays behind the keyboard; hiding it restores the tab edge. A deterministic layout test exercises contraction/restoration without moving the bar, and confirms the active boundary uses the real keyboard guide. Actual keyboard hit-testing remains covered by the controller's targeted UI rerun.

## Keyboard diagnosis and final ownership correction
The guide-based follow-up was disproved by the next actual keyboard UI run. Fixture-only diagnostics recorded the keyboard notification at `(0,539,402,335)`, the focused `VerticalTextView` inside the native root, root bounds `(0,0,402,874)`, but `keyboardLayoutGuide` remained `(0,791,402,83)` even after DidChange and the next run loop. The first unit test only exercised a surrogate bound and did not establish real guide tracking; that earlier assertion is superseded here.

The native root now owns keyboard geometry through `keyboardWillChangeFrame`/`keyboardWillHide` notifications. Screen coordinates convert through the actual window coordinate space into the root view. Intersection with the root gives the required page upper bound; offscreen/hidden frames restore the native tab boundary. Notification animation duration/curve carry through. Only focus inside this root (or its previously owned keyboard) can change its viewport. Child UIHostingControllers use `.container` safe-area regions, avoiding duplicate keyboard avoidance. Removed the ineffective guide constraint and all temporary diagnostic code/launch flags. The layout test now drives the same screen-frame conversion method as notifications, verifies keyboard contraction and restoration without bar motion, and covers offscreen/zero-height/offset bounds. A targeted real keyboard UI rerun remains required before success is claimed.
