"""YOUR HOUSE STYLE FOR GENERATED UI. Edit this file.

## The two levers, and which one you want

There are exactly two places that control how a generated surface looks, and
they do different jobs:

  packages/a2ui-kit/src/styles/a2ui-theme.css
      COLOUR, RADIUS, TYPE. CSS variables scoped to `.a2ui-surface`, mapped to
      your design tokens. Applies to whatever the model produces, after the
      fact. Deterministic — CSS cannot be ignored.

  this file
      STRUCTURE. Which components get used, how they are arranged, what is
      never allowed. Reaches the model that DESIGNS the tree, before it decides
      anything. Influential, not guaranteed: it is a prompt.

Rule of thumb: if you can express it in CSS, do it in CSS. Come here for the
things CSS cannot reach — "compare tables must be horizontal", "never use
Image", "every card leads with the price".

## How it gets there

This text is passed as `composition_guide` in the A2UI guidelines bag, which
`build_subagent_prompt` appends AFTER the built-in generation and design
guidelines. Appending matters: those defaults carry real protocol constraints
(exactly one component with id "root", relative paths inside List templates),
and replacing them wholesale produces surfaces that fail validation.

If you do want to replace a block instead, `render_tool()` in a2ui.py can pass
`design_guidelines` — and `""` suppresses a block entirely.
"""

from __future__ import annotations

HOUSE_STYLE = """\
## House rules for this product catalog

Layout
- Product results are a List of Cards. One Card per product, never a table.
- Use direction="horizontal" for a comparison of 2-4 products so they read
  side by side; use vertical for a list of results.
- Wrap the whole surface in a Column whose first child is a Text with
  variant="h2" naming what is shown ("4 matching products"). Put it outside the
  List so it does not repeat.

Inside a product Card, in this order
0. Image — the product photo, bound to imageUrl (see Images below).
1. Text variant="h3" — the product name.
2. Text variant="h2" — the price, formatted with a currency symbol. Price is
   the number people scan for; it earns the larger size.
3. Text variant="caption" — brand and rating on one line.
4. Text variant="body" — the short description, if there is room.
5. A Row with justify="spaceBetween" per spec you show: label on the left,
   value on the right. Show at most four specs, and choose the ones that
   matter for what the user asked.

Images
- Every product carries an "imageUrl" (a path like "/products/lp-001.jpg") and
  an "imageAlt". Put an Image as the FIRST child of each product Card, before
  the name, bound to that product's imageUrl.
- Use the imageUrl from the data VERBATIM. Never invent one, never guess a
  filename from the product id, never use an external URL. An invented path
  renders as a broken box, and it will look like our bug, not yours.
- Always set the Image alt from imageAlt. A card that is mostly photograph is
  useless to a screen reader without it.
- One image per Card, never a gallery, and never an Image anywhere else in the
  surface.

Never
- Never use an Image for a product that has no imageUrl - fall back to text.
- Never repeat the same value in two components of one Card.
- Never put raw ids (hp-001) in front of the user; they are for tool calls.
- Never show a spec that is identical across every product on screen — it
  cannot help anyone choose.

Wording
- Prices as "$279", not "279" or "279.00 USD".
- Ratings as "4.6 out of 5", not "4.6/5" or a bare number.
- Out-of-stock products still appear, with a Text variant="caption" reading
  "Out of stock" — omitting them silently is worse than showing them.
"""
