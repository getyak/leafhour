# Public book cover localization

Reviewed: 2026-10-28. Coverage: the 64 public books in the live, signed-out catalogue snapshot used for this cover rollout; 256 explicit locale records.

`app/book-cover-labels.mjs` exports a static `bookCoverLabels` object indexed by exact public `bookId`. Each record has `en`, `zh-Hans`, `zh-Hant`, and `ja`, with `title`, `author`, and an optional `subtitle`. It contains display data only. Existing source metadata, reading languages, chapters, translation coverage, passage identifiers, and private books remain separate.

## Editorial decisions

- The artwork is shared across locales and has no embedded words. Localized titles and credits belong to the text layer. Sources and research notes belong here, not on the artwork.
- A localized cover names the work in the reader’s interface language. It does not promise a translated reading text. English-reading sources retain their English edition and translator credits. Chinese originals explicitly say `Chinese text` / `中文原典` / `中国語本文`; the English locale uses English work names rather than copying the catalogue’s Chinese `title.en` values.
- The cover uses familiar work names rather than reproducing every historical subtitle. Material scope remains visible: Walden includes Civil Disobedience, The Awakening includes selected stories, The Prince includes two shorter works, and Lang’s Arabian Nights remains a selection. Darwin’s selected sixth edition remains explicit.
- Translator and editor names remain in their source spelling, with a localized role label. They do not become the author. FitzGerald is credited for an English adaptation; Arnold for English verse; Lang for selection and editing. The unnamed Candide and Arabian Nights translators remain unnamed. Bacon’s W. Wood attribution remains qualified as bibliographic attribution; Joseph Devey remains an editor. Nietzsche’s prose, verse, and appendix translators keep separate roles. Jones’s Odyssey preface is distinct from Butler’s translation.
- Ancient and uncertain attributions retain their qualifications. The Dhammapada is a Buddhist canonical text, not a newly assigned personal author. Red Chamber chapters 81–120 retain an anonymous continuation, with the original Cao Xueqin credit stated as such; the cover does not settle the continuation’s authorship.
- Red Chamber keeps chapters 1–40, 41–80, and 81–120. Montaigne keeps Books 1, 2, and 3, not an imported Japanese publisher’s division. Schopenhauer’s World keeps volumes 1–3 of the selected Haldane/Kemp English edition, not the German original’s two-volume division or a Japanese edition’s division.
- The two Wisdom entries remain the catalogue’s paired parts: The Wisdom of Life and Counsels and Maxims. Their Japanese labels 人生の知恵 and 助言と箴言 are **display translations, not particular Japanese editions**. They are not presented as volumes of a verified Japanese publication. The same rule applies to ブラジル短篇集 for Goldberg’s selected anthology. Its four authors are Machado de Assis, Medeiros e Albuquerque, Henrique Coelho Netto, and Carmen Dolores; the compact Chinese/Japanese credits say four authors, and the English credit lists them.
- Composite scope labels such as めざめと短篇選, アラビアン・ナイト選集, and 語録選・要録 combine an established work name with a faithful description of this selected source. イクイアーノ自伝 is a shortened cover label for the long title recorded by the publisher. None claims a particular Japanese edition or incorporates that edition’s Japanese translator, illustrations, additional works, or volume structure.
- Chinese labels use readable Simplified and Traditional forms. Familiar regional work/author variants are allowed in this separate cover layer; the catalogue and source title fields are unchanged. Book names and credits are protected source-related text under `docs/writing.md`; prose-cleanup rules must not silently alter them.

## Evidence and limits

The reading-edition links and original role credits below come from the public catalogue’s `source` fields. They record the selected reading source, not newly imported Japanese text. Japanese naming was checked against the public library, university, publisher, and publisher-supplied records listed below. Research was limited to public material; no private account library was read.

Naming references establish conventional names. They do not certify paragraph extraction, source completeness, translation quality, or Japanese-language human review. They do not authorize use of any publisher’s cover, typography, or illustrations. The metadata has been checked for 64-book identity coverage, four-locale completeness, nonempty labels, English labels for Chinese originals, and retained material distinctions. Final clipping, line wrapping, alt text, and browser behavior require the renderer’s own verification.

## Japanese naming references

- **J01** — [Kyoto University Library, Great Books title list](https://www.kulib.kyoto-u.ac.jp/yoshidasouthlib/greatbooks/titlelist.pdf). Conventional work names and author identities for the classics listed against this reference. Its Japanese editions and volume divisions are not imported.
- **J02** — [Shinchosha, Alice](https://www.shinchosha.co.jp/book/240101/). 不思議の国のアリス; ルイス・キャロル.
- **J03** — [NDL, Meditations](https://ndlsearch.ndl.go.jp/books/R100000002-I000001570839). 自省録; マルクス・アウレーリウス. Casaubon remains the selected English translator.
- **J04** — [KADOKAWA, Walden](https://www.kadokawa.co.jp/product/322306001008/). 森の生活 is a conventional Japanese work name. Civil Disobedience is retained from the selected Gutenberg source.
- **J05** — [Kodansha, Flatland](https://www.kodansha.co.jp/titles/1000029222). フラットランド. The Japanese publisher’s additional photographs are not part of Leafhour.
- **J06** — [NDL, robot exhibition bibliography](https://www.ndl.go.jp/jp/event/exhibitions/kansai_list_20.pdf). エレホン; Samuel Butler. No Japanese translation from that exhibition is being supplied.
- **J07** — [Tokyo Sogensha, Wells](https://www.tsogen.co.jp/np/isbn/9784488607098). タイム・マシン; H・G・ウェルズ. The Japanese anthology’s extra stories are not imported.
- **J08** — [NDL, A Room of One’s Own](https://ndlsearch.ndl.go.jp/books/R100000002-I026671528). 自分ひとりの部屋; ヴァージニア・ウルフ.
- **J09** — [Kobunsha, Ivan Ilych](https://www.kotensinyaku.jp/books/book09/). イワン・イリイチの死. The Kreutzer Sonata from that Japanese edition is not in the selected CCEL text.
- **J10** — [CiNii, The Awakening](https://ci.nii.ac.jp/ncid/BN07134554). めざめ; ケイト・ショパン. と短篇選 is a display translation of the selected English anthology’s scope.
- **J11** — [Publisher-supplied Books record, The Home and the World](https://www.books.or.jp/book-details/9784476011708). 家と世界. Leafhour retains Surendranath Tagore’s English translation and does not adopt the Japanese publication’s upper/lower division.
- **J12** — [IBC Publishing, The Book of Tea](https://ibcpub.co.jp/detail/9784896846850/). 茶の本; 岡倉天心 (岡倉覚三). Leafhour supplies the English original, not the linked bilingual publication.
- **J13** — [KADOKAWA, The Prophet](https://www.kadokawa.co.jp/product/322602001264/). 預言者; カリール・ジブラン. This spelling is used for the author’s English-publication name Kahlil Gibran.
- **J14** — [NDL, Dhammapada](https://ndlsearch.ndl.go.jp/books/R100000002-I000001682077). ダンマパダ. The additional Udānavarga in this Japanese publication is not claimed for Leafhour.
- **J15** — [NDL, Bhagavad-Gita](https://ndlsearch.ndl.go.jp/books/R100000002-I000002170157). バガヴァッド・ギーター. Leafhour retains Arnold’s English verse and traditional Vyasa attribution.
- **J16** — [NDL, Rubaiyat](https://ndlsearch.ndl.go.jp/books/R100000002-I000004355547). ルバイヤート; オマル・ハイヤーム. FitzGerald is separately credited for the selected English adaptation. Its [Gutenberg 246 reading source](https://www.gutenberg.org/ebooks/246) includes the first and fifth FitzGerald editions as separate chapters; all four cover subtitles retain that distinction.
- **J17** — [Shinchosha, Notes from the Underground](https://www.shinchosha.co.jp/book/201009/). 地下室の手記; ドストエフスキー.
- **J18** — [Shinchosha, Werther](https://www.shinchosha.co.jp/book/201501/). 若きウェルテルの悩み; ゲーテ.
- **J19** — [Publisher-supplied Hanmoto record, Candide](https://www.hanmoto.com/bd/isbn/9784003251812). カンディード; ヴォルテール. No translator is inferred for the unnamed 1918 English edition.
- **J20** — [CiNii Books, アラビアン・ナイト, NCID BA31128159](https://ci.nii.ac.jp/ncid/BA31128159). This exact work record describes the 1959.5 Tokyo Sogensha Japanese volume in ラング世界童話全集, 別巻, credited to Andrew Lang, with Japanese translation by 川端康成 and 野上彰 (238 pages). It confirms the Japanese work name and Lang association only. Leafhour’s reading source remains [Project Gutenberg 128, The Arabian Nights Entertainments](https://www.gutenberg.org/ebooks/128), selected and edited by Lang, with English translators not individually named. 選集 describes that English selection; Leafhour does not claim the Japanese volume’s four-story contents, translation, or illustrations.
- **J21** — [CiNii Research, Azuela study](https://cir.nii.ac.jp/crid/1520572358473838080). A research article explicitly identifies Los de abajo as 虐げられし人々 by マリアノ・アスエラ.
- **J22** — [Publisher-supplied Hanmoto record, Equiano](https://www.hanmoto.com/bd/isbn/9784327180553). Author spelling オラウダ・イクイアーノ and published title アフリカ人、イクイアーノの生涯の興味深い物語. イクイアーノ自伝 is a shortened display label.
- **J23** — [CiNii, Schreiner](https://ci.nii.ac.jp/ncid/BA77616514). アフリカ農場物語; オリーヴ・シュライナー.
- **J24** — [NDL, Douglass](https://ndlsearch.ndl.go.jp/books/R100000002-I027014067). The subtitle フレデリック・ダグラス自伝 names the 1845 Narrative, not his later autobiographies.
- **J25** — [NDL, Seacole](https://ndlsearch.ndl.go.jp/en/books/R100000002-I028183629). メアリー・シーコール自伝; メアリー・シーコール. The English selected title remains Wonderful Adventures of Mrs. Seacole in Many Lands.
- **J26** — [Chikuma, Nietzsche](https://www.chikumashobo.co.jp/product/9784480080813/). 善悪の彼岸 and 道徳の系譜 identify the works; Leafhour’s separate English sources and appendix translators remain distinct.
- **J27** — [CiNii, Zarathustra](https://ci.nii.ac.jp/ncid/BN00476447). ツァラトゥストラはこう語った. Thomas Common’s English translation remains the reading edition.
- **J28** — [Tokyo Metropolitan University Library, Epictetus](https://opactmu.lib.tmu.ac.jp/iwjs0013opc/ctlsrh.do?locale=ja&ncid=BB23303217&search_mode=detail&tab_num=0). 語録 and 要録. The cover adds 選 because George Long’s selected source is not the complete Discourses.
- **J29** — [NDL, Spinoza](https://ndlsearch.ndl.go.jp/books/R100000001-I23211009410246468). エチカ; スピノザ. Alternative Japanese transcription エティカ also occurs in J01.
- **J30** — [NDL, Hume](https://ndlsearch.ndl.go.jp/books/R100000136-I1970304959820694928). 人間知性研究; デイヴィッド・ヒューム.
- **J31** — [Publisher-supplied Hanmoto record, Bacon](https://www.hanmoto.com/bd/isbn/9784003361726). ノヴム・オルガヌム; フランシス・ベーコン. Translator attribution follows the selected source, not this Japanese edition.
- **J32** — [Chuo Koron Shinsha, Thucydides](https://www.chuko.co.jp/zenshu/2013/12/160144.html). 戦史; トゥキュディデス. The subtitle identifies the Peloponnesian War and English text.
- **J33** — [NDL, Dream of the Red Chamber](https://ndlsearch.ndl.go.jp/books/R100000002-I000000693405). 紅楼夢; 曹雪芹. This naming reference does not resolve the selected text’s anonymous continuation or change Leafhour’s three 40-chapter divisions.
- **J34** — [Chuo Koron Shinsha, Schopenhauer](https://www.chuko.co.jp/zenshu/2004/08/160069.html). 意志と表象としての世界; ショーペンハウアー. The Japanese publication’s divisions are not used for the three-volume Haldane/Kemp English edition.

## Selected reading editions and label coverage

The four-language object is the complete label list; this table binds every identifier to its selected source and Japanese naming evidence.

| Public book identifier | English cover title | Japanese cover title | Selected reading edition | Japanese naming evidence |
| --- | --- | --- | --- | --- |
| `gutenberg-alice` | Alice’s Adventures in Wonderland | 不思議の国のアリス | [Project Gutenberg 11](https://www.gutenberg.org/ebooks/11) | J02 |
| `gutenberg-meditations` | Meditations | 自省録 | [Project Gutenberg 2680](https://www.gutenberg.org/ebooks/2680) | J03 |
| `gutenberg-walden` | Walden | 森の生活 | [Project Gutenberg 205](https://www.gutenberg.org/ebooks/205) | J04 |
| `gutenberg-flatland` | Flatland | フラットランド | [Project Gutenberg 201](https://www.gutenberg.org/ebooks/201) | J05 |
| `gutenberg-frankenstein` | Frankenstein | フランケンシュタイン | [Project Gutenberg 84](https://www.gutenberg.org/ebooks/84) | J01 |
| `gutenberg-erewhon` | Erewhon | エレホン | [Project Gutenberg 1906](https://www.gutenberg.org/ebooks/1906) | J06 |
| `gutenberg-time-machine` | The Time Machine | タイム・マシン | [Project Gutenberg 35](https://www.gutenberg.org/ebooks/35) | J07 |
| `gutenberg-au-room-of-ones-own` | A Room of One’s Own | 自分ひとりの部屋 | [Project Gutenberg Australia](https://gutenberg.net.au/ebooks02/0200791h.html) | J08 |
| `gutenberg-on-liberty` | On Liberty | 自由論 | [Project Gutenberg 34901](https://www.gutenberg.org/ebooks/34901) | J01 |
| `ccel-ivan-ilych` | The Death of Ivan Ilych | イワン・イリイチの死 | [CCEL](https://ccel.org/ccel/tolstoy/ivan/ivan) | J09 |
| `gutenberg-awakening` | The Awakening and Selected Short Stories | めざめと短篇選 | [Project Gutenberg 160](https://www.gutenberg.org/ebooks/160) | J10 |
| `gutenberg-home-and-world` | The Home and the World | 家と世界 | [Project Gutenberg 7166](https://www.gutenberg.org/ebooks/7166) | J11 |
| `gutenberg-brazilian-tales` | Brazilian Tales | ブラジル短篇集 | [Project Gutenberg 21040](https://www.gutenberg.org/ebooks/21040) | Display translation |
| `gutenberg-book-of-tea` | The Book of Tea | 茶の本 | [Project Gutenberg 769](https://www.gutenberg.org/ebooks/769) | J12 |
| `gutenberg-prophet` | The Prophet | 預言者 | [Project Gutenberg 58585](https://www.gutenberg.org/ebooks/58585) | J13 |
| `gutenberg-tao-te-ching` | The Tao Teh King | 老子 | [Project Gutenberg 216](https://www.gutenberg.org/ebooks/216) | J01 |
| `gutenberg-dhammapada` | The Dhammapada | ダンマパダ | [Project Gutenberg 2017](https://www.gutenberg.org/ebooks/2017) | J14 |
| `gutenberg-bhagavad-gita` | The Song Celestial | バガヴァッド・ギーター | [Project Gutenberg 2388](https://www.gutenberg.org/ebooks/2388) | J15 |
| `gutenberg-rubaiyat` | The Rubaiyat of Omar Khayyam | ルバイヤート | [Project Gutenberg 246](https://www.gutenberg.org/ebooks/246) | J16 |
| `gutenberg-notes-underground` | Notes from the Underground | 地下室の手記 | [Project Gutenberg 600](https://www.gutenberg.org/ebooks/600) | J17 |
| `gutenberg-young-werther` | The Sorrows of Young Werther | 若きウェルテルの悩み | [Project Gutenberg 2527](https://www.gutenberg.org/ebooks/2527) | J18 |
| `gutenberg-pride-prejudice` | Pride and Prejudice | 高慢と偏見 | [Project Gutenberg 1342](https://www.gutenberg.org/ebooks/1342) | J01 |
| `gutenberg-don-quixote` | Don Quixote | ドン・キホーテ | [Project Gutenberg 996](https://www.gutenberg.org/ebooks/996) | J01 |
| `gutenberg-candide` | Candide | カンディード | [Project Gutenberg 19942](https://www.gutenberg.org/ebooks/19942) | J19 |
| `gutenberg-arabian-nights` | The Arabian Nights Entertainments | アラビアン・ナイト選集 | [Project Gutenberg 128](https://www.gutenberg.org/ebooks/128) | J20 |
| `gutenberg-underdogs` | The Underdogs | 虐げられし人々 | [Project Gutenberg 549](https://www.gutenberg.org/ebooks/549) | J21 |
| `gutenberg-equiano` | The Interesting Narrative of Olaudah Equiano | イクイアーノ自伝 | [Project Gutenberg 15399](https://www.gutenberg.org/ebooks/15399) | J22 |
| `gutenberg-african-farm` | The Story of an African Farm | アフリカ農場物語 | [Project Gutenberg 1441](https://www.gutenberg.org/ebooks/1441) | J23 |
| `gutenberg-douglass` | Narrative of the Life of Frederick Douglass | フレデリック・ダグラス自伝 | [Project Gutenberg 23](https://www.gutenberg.org/ebooks/23) | J24 |
| `gutenberg-seacole` | Wonderful Adventures of Mrs. Seacole in Many Lands | メアリー・シーコール自伝 | [Project Gutenberg 23031](https://www.gutenberg.org/ebooks/23031) | J25 |
| `gutenberg-beyond-good-and-evil` | Beyond Good and Evil | 善悪の彼岸 | [Project Gutenberg 4363](https://www.gutenberg.org/ebooks/4363) | J26 |
| `gutenberg-zarathustra` | Thus Spake Zarathustra | ツァラトゥストラはこう語った | [Project Gutenberg 1998](https://www.gutenberg.org/ebooks/1998) | J27 |
| `gutenberg-analects-zh` | The Analects | 論語 | [Project Gutenberg 23839](https://www.gutenberg.org/ebooks/23839) | J01 |
| `gutenberg-mencius-zh` | Mencius | 孟子 | [Project Gutenberg 24178](https://www.gutenberg.org/ebooks/24178) | J01 |
| `gutenberg-zhuangzi-zh` | Zhuangzi | 荘子 | [Project Gutenberg 23913](https://www.gutenberg.org/ebooks/23913) | J01 |
| `gutenberg-art-of-war-zh` | The Art of War | 孫子 | [Project Gutenberg 23864](https://www.gutenberg.org/ebooks/23864) | J01 |
| `gutenberg-tao-te-ching-zh` | Tao Te Ching | 老子 | [Project Gutenberg 7337](https://www.gutenberg.org/ebooks/7337) | J01 |
| `gutenberg-republic` | The Republic | 国家 | [Project Gutenberg 1497](https://www.gutenberg.org/ebooks/1497) | J01 |
| `gutenberg-nicomachean-ethics` | Nicomachean Ethics | ニコマコス倫理学 | [Project Gutenberg 8438](https://www.gutenberg.org/ebooks/8438) | J01 |
| `gutenberg-epictetus-discourses-handbook` | Selected Discourses and the Encheiridion | 語録選・要録 | [Project Gutenberg 10661](https://www.gutenberg.org/ebooks/10661) | J28 |
| `gutenberg-confessions-augustine` | Confessions | 告白録 | [Project Gutenberg 3296](https://www.gutenberg.org/ebooks/3296) | J01 |
| `gutenberg-prince` | The Prince | 君主論 | [Project Gutenberg 1232](https://www.gutenberg.org/ebooks/1232) | J01 |
| `gutenberg-discourse-on-method` | Discourse on Method | 方法序説 | [Project Gutenberg 59](https://www.gutenberg.org/ebooks/59) | J01 |
| `gutenberg-ethics-spinoza` | Ethics | エチカ | [Project Gutenberg 3800](https://www.gutenberg.org/ebooks/3800) | J29 |
| `gutenberg-enquiry-human-understanding` | An Enquiry Concerning Human Understanding | 人間知性研究 | [Project Gutenberg 9662](https://www.gutenberg.org/ebooks/9662) | J30 |
| `gutenberg-novum-organum` | Novum Organum | ノヴム・オルガヌム | [Project Gutenberg 45988](https://www.gutenberg.org/ebooks/45988) | J31 |
| `gutenberg-hamlet` | Hamlet | ハムレット | [Project Gutenberg 1524](https://www.gutenberg.org/ebooks/1524) | J01 |
| `gutenberg-odyssey` | The Odyssey | オデュッセイア | [Project Gutenberg 1727](https://www.gutenberg.org/ebooks/1727) | J01 |
| `gutenberg-crime-and-punishment` | Crime and Punishment | 罪と罰 | [Project Gutenberg 2554](https://www.gutenberg.org/ebooks/2554) | J01 |
| `gutenberg-wealth-of-nations` | The Wealth of Nations | 国富論 | [Project Gutenberg 3300](https://www.gutenberg.org/ebooks/3300) | J01 |
| `gutenberg-origin-of-species` | On the Origin of Species | 種の起源 | [Project Gutenberg 2009](https://www.gutenberg.org/ebooks/2009) | J01 |
| `gutenberg-peloponnesian-war` | The History of the Peloponnesian War | 戦史 | [Project Gutenberg 7142](https://www.gutenberg.org/ebooks/7142) | J32 |
| `gutenberg-wisdom-of-life-1` | The Wisdom of Life | 人生の知恵 | [Project Gutenberg 10741](https://www.gutenberg.org/ebooks/10741) | Display translation |
| `gutenberg-wisdom-of-life-2` | Counsels and Maxims | 助言と箴言 | [Project Gutenberg 10715](https://www.gutenberg.org/ebooks/10715) | Display translation |
| `gutenberg-genealogy-of-morals` | The Genealogy of Morals | 道徳の系譜 | [Project Gutenberg 52319](https://www.gutenberg.org/ebooks/52319) | J26 |
| `gutenberg-dream-red-chamber-1` | Dream of the Red Chamber | 紅楼夢 | [Project Gutenberg 24264](https://www.gutenberg.org/ebooks/24264) | J33 |
| `gutenberg-dream-red-chamber-2` | Dream of the Red Chamber | 紅楼夢 | [Project Gutenberg 24264](https://www.gutenberg.org/ebooks/24264) | J33 |
| `gutenberg-dream-red-chamber-3` | Dream of the Red Chamber | 紅楼夢 | [Project Gutenberg 24264](https://www.gutenberg.org/ebooks/24264) | J33 |
| `gutenberg-essays-montaigne-1` | The Essays of Montaigne | エセー | [Project Gutenberg 3600](https://www.gutenberg.org/ebooks/3600) | J01 |
| `gutenberg-essays-montaigne-2` | The Essays of Montaigne | エセー | [Project Gutenberg 3600](https://www.gutenberg.org/ebooks/3600) | J01 |
| `gutenberg-essays-montaigne-3` | The Essays of Montaigne | エセー | [Project Gutenberg 3600](https://www.gutenberg.org/ebooks/3600) | J01 |
| `gutenberg-world-will-idea-1` | The World as Will and Idea | 意志と表象としての世界 | [Project Gutenberg 38427](https://www.gutenberg.org/ebooks/38427) | J34 |
| `gutenberg-world-will-idea-2` | The World as Will and Idea | 意志と表象としての世界 | [Project Gutenberg 40097](https://www.gutenberg.org/ebooks/40097) | J34 |
| `gutenberg-world-will-idea-3` | The World as Will and Idea | 意志と表象としての世界 | [Project Gutenberg 40868](https://www.gutenberg.org/ebooks/40868) | J34 |

## Validation boundary

A direct module import and catalogue comparison confirmed 64 exact book identifiers, 256 locale records, and a nonempty title/author for every locale. Every English title contains English/Latin text rather than a Chinese source-title fallback. The three Red Chamber ranges, three Montaigne books, three English World volumes, and two Wisdom parts remain distinguishable. This metadata-only check does not report a production deployment or a visual acceptance result.
