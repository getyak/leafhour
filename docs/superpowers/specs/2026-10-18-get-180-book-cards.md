# GET-180 — quieter shelf cards

The physical book covers remain the shelf's main visual element. Shelf items
stretch within each grid row; flexible metadata columns place read actions at
the same row bottom without fixed card heights. The title is a real reading
anchor with at most two visual lines. Author text stays complete in the DOM,
accessible tree, title tooltip and existing book-information dialog, with one
visual line on the shelf.

A Chinese trial is one metadata anchor using the existing sample URL helper,
not a duplicate action. Desktop reading actions appear on card hover, keyboard
focus or an open menu. They stay keyboard-reachable while visually quiet.
Compact layouts, any coarse pointer (including hybrid devices) or absence of
hover keep actions visible with 44px controls. Existing keyboard reorder and
menu actions remain; no nested anchors or whole-article click handler.

The existing shared hairline is rendered as one quiet shelf rule. Covers,
source text, book IDs, personal data, drag ordering, incremental shelf and
resume/sample URL semantics are retained. Landing-page cards are outside this
layout change. A separately observed compact current-book menu clipping issue
is repaired by moving its 44px button inside the heading's available bounds.

Acceptance uses native Chrome at 1200px and 390×844, short/long titles, the
longest public author, idle and keyboard state, light/night paper, sample and
title navigation, menus and the current-book layout. CSS supports hybrid media
conditions; responsive screenshots do not claim physical touch, actual hybrid
hardware or screen-reader acceptance. Verification and original captures are
in the companion [record](../../verification/2026-10-18-get-180-book-cards.md).
