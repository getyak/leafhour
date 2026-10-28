# GET-281 reading refinement

The issue requests Impeccable installation, durable product/design context, and a full pass across reading, half-screen conversation and sleeping chrome. Scope is the existing reader; no generation, data migration or library redesign.

The chosen approach refines the current native modules and shared tokens. A new reader shell would duplicate stable selection, pagination and anchor behavior. A global visual reset would expand scope and risk other pages. Keep those owners and edit the CSS at its source.

Observed baseline: `fd16fd3`. The sleeping launcher still paints a filled bordered capsule and shadow; its conversation entry remains visible. Mobile conversation occupies 76% of the viewport. Answers carry a bordered rounded card inside the conversation sheet. Preserve the established book typography and remove these competing surfaces.

Implement the states in root DESIGN.md. Half-height sheets retain the existing compact viewport exception, mobile focus containment and wide-panel anchor restoration. Unread and focused entries remain discoverable. Privacy/cost/source distinctions are unaffected.

Validation must use real browser geometry, keyboard return, scroll/timer sleep, selection, wide reflow, four locales and short viewports. Capture before/after states. Run the official detector without ignores on the relevant source and live reading states, record primary/advisory results separately, and retain the tool version. Compare Ambi's environmental restraint, Linear's hierarchy and Arc's disappearing chrome as design references, not as templates or validation claims.

The user's instruction to complete design and implementation authorizes these implementation choices. They are builder decisions, not evidence of a separate user design review. Complete necessary tests, independent review, CI, normal merge and production acceptance under AGENTS.md.
