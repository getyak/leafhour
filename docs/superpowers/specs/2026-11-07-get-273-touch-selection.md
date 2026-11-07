# GET-273: native touch selection and three actions

The original GET-273 scope remains in force. A phone tap on prose stays quiet. A stationary native long press creates a selection, initially expanded to its sentence (or paragraph when sentence segmentation is unavailable). Native handles can then shrink or extend it, including across passages. Scrolling must not create a menu. No permanent paragraph selection controls are added.

Observe touch intent without preventing native events or synthesizing a long press. Normalize only the first noncollapsed range from a stationary hold in reader prose. Use `Intl.Segmenter` sentence boundaries and existing UTF-16 DOM ranges; never rewrite text. Movement, early release, navigation, session changes and disposal invalidate pending intent. Desktop and keyboard selection remain unchanged.

The anchored touch toolbar contains exactly Explain this sentence, View original, and Write a note. Prefer placement below the selected text to leave room for native copy controls. Explain attaches the existing typed quote to the real companion conversation, without sending or invoking a model. Note uses the existing account-scoped composer and draft recovery. View original opens a read-only dialog: an original-language selection shows that exact slice; a translated selection shows the corresponding original passage, explicitly labeled as passage context because no character alignment exists. Closing it leaves prose, selection snapshot and reading position intact.

Preserve book/version/passage provenance, multi-passage snapshots, source formatting rules, literal user Markdown, and explicit send/save semantics. Do not read private notes, call a provider, persist synthetic data, change release configuration, or touch reserved simulators. Host and synthetic browser evidence are separate from actual iOS Safari/physical-device and paused Production acceptance.

Sentence segmentation follows the [ECMA-402 Segmenter contract](https://402.ecma-international.org/13.0/#sec-intl.segmenter). Browser selection remains native; automatic linguistic sentence boundaries are a default that the reader can adjust.
