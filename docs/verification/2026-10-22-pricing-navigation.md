# Pricing and public navigation — October 22, 2026

Base: public main `9eef5662127c3891872195aabf77c2928471ad74`.

The requested change adds Agent access, Pricing and an identifiable GitHub mark to the public header, and brings pricing into the current home visual system. No price, point grant, subscription, payment activation or account ownership rule changes.

## Implementation

- `public-navigation.mjs` owns the canonical localized destinations and public navigation markup. The GitHub mark is from official Primer Octicons; its upstream MIT notice is retained in the module.
- Home HTML retains a complete fallback header; server-generated locale pages render the same entries before JavaScript. Language commits update the original and cloned Agent/Pricing links without touching books, reading records or billing.
- Pricing, terms and refunds use the existing native home menu controller. Their public-only bootstrap owns the close button rather than assuming the home portal's close handler is present. Header and language links remain real anchors.
- Authored commerce paths now resolve their own locale, including English aliases. Unsupported paths keep the existing canonical-surface locale policy.
- `commerce.css` is loaded only by public commerce documents. It shares the current soft-white/graphite/pine-green palette, uses readable sans-serif type, two product cards, a clear consumption table and quieter policy notes. Private billing statements and reader themes retain their own styles.
- Narrow headers show a short point label; the accessible name contains both the short label and full billing destination. GitHub has a named icon on desktop and a visible name inside the menu.

## Review and actual browser evidence

An independent review found the commerce close button missing its owner. Browser interaction reproduced an open menu after clicking ×; after the public bootstrap fix, the same action closes it. Native Escape also closes the menu and returns focus to its trigger.

Browser checks used an isolated local server with synthetic/temporary storage and no provider credentials. Chinese pricing was inspected at 320, 390, 768 and desktop width; English and Japanese at 320; English also at 768. The short header fixes the reproduced English/Japanese 320px overflow. No horizontal page overflow remains in these checks. Both light and explicit night appearance were inspected, and the original system mode was restored. Home/menu links preserve their locale, and the browser recorded no JavaScript errors.

- [Desktop pricing](2026-10-22-pricing-navigation/pricing-desktop.png)
- [Mobile pricing](2026-10-22-pricing-navigation/pricing-390.png)
- [Mobile public menu](2026-10-22-pricing-navigation/pricing-menu-390.png)
- [Mobile home menu](2026-10-22-pricing-navigation/home-menu-390.png)
- [Night pricing](2026-10-22-pricing-navigation/pricing-night.png)
- [Desktop home header](2026-10-22-pricing-navigation/home-desktop.png)

The focused locale/menu/commerce suite passes 75 tests. The new first-paint navigation cases failed before implementation. The accessible-name regression failed before its label fix and passed afterward. Final Node 22 deployment verification: **3,147 passed, 0 failed, 1 platform-only skip** (3,148 total). The runtime initializes, hosted build contains 404 public files and 11 registered media assets, and release closure checks 863 software files. Reader startup and deferred annotation caps pass unchanged. Real pinned Vale/textlint and planted-negative canaries pass; 0 new T1 errors, no new allowance or debt exemptions. Production acceptance is recorded in the PR after merging.

Financial behavior remains unchanged: static pricing starts with payments unavailable and obtains live availability from the actual catalog. This task creates no payment, trial grant, subscription, real model/OCR job or hosted migration.
