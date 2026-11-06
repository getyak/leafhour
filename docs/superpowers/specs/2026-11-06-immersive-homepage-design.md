# Leafhour immersive homepage

User request: reverse engineer https://www.ambi.ai/en and improve https://leafhour.com with Three.js, GSAP, Web/iOS product demonstrations, voice, reading translation and native AI interaction. Continue evaluating toward a documented score above 95.

## Direction

Retain Leafhour paper, forest green, Newsreader and Chinese serif identity. Replace hero photography with a product stage: an accessible HTML Web reading window, a dimensional iPhone reader and a real Three.js sculpture of unfolding pages. Native scroll changes depth using GSAP ScrollTrigger. Keep all copy and navigation useful without WebGL or JavaScript. Existing sample, public bookshelf, ownership and legal links remain.

Ambi observations (2026-11-06, live Chrome): monumental centered headline; scattered foreground/background panels; native scrolling recedes and blurs secondary objects; editorial feature sections; generous quiet intervals. This is observed visual behavior, not proof of Ambi's implementation stack. Reuse composition and depth principles, not third-party art, source code or branding.

Alternatives considered: adding effects to existing photos does not demonstrate the product; a full-screen 3D-only site obscures reading and hurts accessibility. Chosen implementation combines readable HTML product demonstrations with optional 3D.

## Content and interaction

Hero retains the existing headline and real sample CTA. Web demonstration has source/translation/AI modes with authored, labelled examples. Language selection in the existing reading sample remains intact. Listening demo is opt-in browser speech synthesis with a visible unavailable state; no autoplay, recording, service request or account data. iOS panel shows current product capabilities and links to public native project documentation, labelled beta. Translation and AI examples retain their example/draft identity; no zero-latency/full-book claims.

## Engineering and acceptance

Homepage-only files, removed from shared library rendering. Vendor pinned Three.js and GSAP locally, with licenses; no third-party runtime CDN. Load optional effects after content is usable; respect reduced motion, save-data and visibility. Bound render resolution and stop offscreen work. No private content, credentials or generated model calls.

Verify four locales, 360/390/768/1440 widths, keyboard controls, reduced motion, WebGL failure, voice availability, library isolation, affected tests and production build. Review screenshots and audit performance/accessibility; document rubric, failures, fixes and actual scores separately from unverified real-iPhone behavior. No claim of 95+ unless evidenced. Existing repository PR/main-only production workflow and zero-paid-CI budget apply.
