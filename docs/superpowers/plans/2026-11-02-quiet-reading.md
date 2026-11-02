# Quiet reading implementation

1. Extend ReaderPreferences compatibly with a Latin font family and Kai Chinese style; centralize supported paper IDs. Check JSON legacy defaults, round trip and scope persistence with isolated libraries.
2. Resolve local fonts with explicit Chinese fallback and Dynamic Type. Use the same resolver in TextKit and previews; include family in layout invalidation. Verify actual Core Text runs for mixed text.
3. Replace verbose typography controls with compact size/spacing, live Chinese samples and a Latin chooser. Expand paper swatches with visible names. Keep independent text/paper/reading categories, original-PDF limitation and recoverable saves.
4. Replace reader tools' vertical menu with labeled icon tiles. Keep all existing destinations, share/export distinctions and direct continue-reading path. Simplify global settings secondary wording.
5. Build and run affected core/app tests and synthetic simulator flows. Inspect screenshots at normal and accessibility size. Record remaining limits. Review diff, push once, await CI, merge normally and distinguish source delivery from native distribution.

Review focus: legacy fields must not lose notes; Latin font changes must invalidate pagination; CJK choices must use actual CJK glyphs; night paper must set a dark foreground scheme; accessibility must expand rather than truncate controls.
