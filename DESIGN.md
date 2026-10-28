---
name: Leafhour
description: A private reading room
colors:
  paper: "#faf9f5"
  ink: "#292a25"
  muted: "#6b695f"
  accent: "#3f594c"
  panel: "#fdfcf8"
  night-paper: "#181b19"
  night-ink: "#e4e5dc"
rounded:
  control: "6px"
  dialog: "10px"
spacing:
  control-target: "44px"
---

# Leafhour interface

## Overview

The book is the primary surface. Preserve the established type, palettes and measured line length. Whitespace separates text and controls. Design decisions below are extracted from the code and GET-281 brief; they do not claim a separate user taste interview or reader-research result.

## Colors

`app/styles.css` owns reader paper, ink, muted, accent and panel values, including night and legacy palettes. `app/reader-atmosphere.css` adjusts the room around an opaque reading column. Keep those palette owners and reader preferences; do not introduce a second palette in conversation. Color identifies interaction or content ownership. Costs, source status and errors must stay legible.

## Typography

`app/typography.css` owns the self-hosted Newsreader and system CJK serif book stacks and the system sans interface stack. Default reading is 22px at a 650px measure, subject to reader preferences and mobile rules. Conversation body uses the book serif at 16px / 1.9; interface labels keep the system sans. Preserve original source text, explicit source formatting and translation identity. Keep the functional chapter number; it carries actual book structure.

## Layout

Wide conversation uses a resizable 320–640px side column and reflows the book while preserving its source anchor. Narrow conversation occupies half the visual viewport, with a 360px minimum so answer text and the composer fit. Visual viewports of 500px or less use the existing full-height compact mode. An attached source quote also expands to full height until removed. Embedded annotations use a full-height scrollable frame. Position against the visual viewport, including keyboard offsets. Mobile modality and scroll containment remain intact.

## Elevation & Depth

Use the shared `app/interface-tokens.css` focus ring, hairlines and raised surfaces. The sleeping launcher has no visible fill, border or shadow and cannot intercept book input. Revealed tools and an unread or focused conversation entry retain an opaque surface. Answer text has no enclosing card; the conversation boundary already identifies it. Source previews and secondary menus use plain text and restrained rules.

## Shapes

Use the existing 6px control and 10px dialog tiers. The mobile sheet has 12px top corners; compact mode has square edges. Preserve 44px action targets and a visible keyboard ring. Document highlights retain their semantic color and a 1px quote rule.

## Components

- **Reading:** the header and tools sleep. A completed click in the top or bottom 44px edge wakes the existing tools. Hover, drag and selection do not. Keyboard focus reveals a labelled edge; an unread companion message can expose its existing entry.
- **Tools:** one reveal coordinates header and tray. Keep the five-second timer, selection/keyboard/dialog holds and scroll dismissal. `reader-quiet.css` owns sleeping chrome; lazy `reading-hub.css` owns only the tray layout.
- **Conversation:** plain book-serif answers retain attribution, citations and copy actions. The input remains a distinct working control. Closing restores its entry and the reading position without reopening tools.
- **Motion:** no decorative status pulse or character blink. Pending work retains its status text and static dot. Respect reduced motion; do not add animation for polish.

## Do's and Don'ts

Impeccable `quieter` removes competing surfaces; `distill` preserves one path to existing tools; `critique` checks hierarchy and recovery; `polish` checks rendered states across locales, themes and viewports. Detector results supplement visual review. Do not add dashboard grids, nested cards, decorative gradients, new model calls or broader data access. Keep privacy, prices, failures and provenance available at the relevant action.
