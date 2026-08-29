"""YOUR HOUSE STYLE FOR GENERATED UI. Edit this file.

## The two levers, and which one you want

There are exactly two places that control how a generated surface looks, and
they do different jobs:

  packages/a2ui-kit/src/styles/a2ui-theme.css
      COLOUR, RADIUS, TYPE, and LAYOUT. CSS scoped to `.a2ui-surface`, mapped to
      your design tokens. Applies to whatever the model produces, after the
      fact. Deterministic - CSS cannot be ignored.

  this file
      STRUCTURE. Which components get used, in what order, and what is never
      allowed. Reaches the model that DESIGNS the tree, before it decides
      anything. Influential, not guaranteed: it is a prompt.

Rule of thumb: if you can express it in CSS, do it in CSS. The responsive card
grid is a good example - asking the model for "3 to 5 per row depending on
width" is a wish, while a CSS grid template is a fact.

## The rule this file learned the hard way

A prompt can only ask for things the runtime can actually do. An A2UI binding
POINTS AT a value; it cannot format, concatenate, or branch.

This file used to ask for "prices as $279", "brand and rating on one line", and
a caption for out-of-stock products. None of those is expressible as a binding,
so the subagent approximated: it shipped a bare `229`, bound `brand` and
dropped the rating, and wrote a LITERAL "Out of stock" into the card template -
which then rendered on every product in the list, in-stock ones included.

The fix was not a firmer prompt. It was `display_product()` in a2ui.py, which
precomputes every string a card can show as a flat top-level field, so the
model's only remaining job is choosing which to display and where.

If you add a rule below that asks the model to compute anything, add the field
to `display_product()` instead.

## How it gets there

This text is passed as `composition_guide` in the A2UI guidelines bag, which
`build_subagent_prompt` appends AFTER the built-in generation and design
guidelines. Appending matters: those defaults carry real protocol constraints
(exactly one component with id "root", relative paths inside List templates),
and replacing them wholesale produces surfaces that fail validation.

If you do want to replace a block instead, `render_tool()` in a2ui.py can pass
`design_guidelines` - and "" suppresses a block entirely.
"""

from __future__ import annotations

HOUSE_STYLE = """\
## House rules for this product catalog

### The one rule everything else follows

You can only BIND to a value that already exists. You cannot format one, join
two together, or choose between them. So every string a card needs has already
been prepared for you as a FLAT, TOP-LEVEL field on each product.

Bind those fields. Never build a string, never bind a nested path.

Available on every product, ready to display exactly as-is:

  imageUrl     "/products/hp-001.jpg"     imageAlt    alt text for that photo
  name         "Aether NC 900"            priceLabel  "$399"
  brandLine    "SONARE - 4.8 out of 5 - 4.1K reviews"
  description  the one-line summary
  stockLabel   "In stock" or "Out of stock", already correct for that product
  spec1Label   "Battery"                  spec1Value  "32 h"
  spec2Label / spec2Value, and so on through spec4Label / spec4Value

There is no `specs` object and no bare `price` number in your data. If you catch
yourself reaching for {"path": "specs/type"} or {"path": "price"}, the field you
want is spec1Value or priceLabel. A nested path inside a List template resolves
to nothing, and the card renders blank without any error.

Products with fewer than four specs have empty strings in the unused slots. An
empty Text renders as nothing, so bind all four without checking.

### Layout

- Product results are a List of Cards. One Card per product, never a table.
- Use direction="horizontal" for product results and for comparisons. The
  surface is styled as a responsive grid, so the cards flow onto as many rows
  as the chat width allows. Use vertical only for a single result.
- Wrap the whole surface in a Column whose first child is a Text variant="h2"
  naming what is shown ("9 matching products"). Keep it outside the List so it
  does not repeat on every card.

### Inside a product Card, in this order

1. Image                  - src bound to imageUrl, alt bound to imageAlt.
2. Text variant="h3"      - name
3. Text variant="h2"      - priceLabel
4. Text variant="caption" - brandLine
5. Text variant="caption" - stockLabel
6. Text variant="body"    - description
7. Up to four Rows, justify="spaceBetween", each holding two Texts: specNLabel
   on the left, specNValue on the right.


### A cart surface

A cart arrives under `cart`, not `products`. Its lines are in `cart.items`
and use the SAME field names as a product, plus three of their own:

  quantityLabel   "Qty 2"
  lineTotalLabel  "$6,598"     price for that line, already multiplied
  cart.subtotalLabel and cart.itemCountLabel for the totals
  cart.truncatedLabel  "Showing 12 of 36 lines", or empty when all fit

Build it as a Column: a Text variant="h2" with itemCountLabel, then a List
bound to /cart/items, then a Row with justify="spaceBetween" holding the
word "Subtotal" and subtotalLabel.

Bind truncatedLabel as a Text variant="caption" just under the List. Long
carts show only their first lines, and a total that does not match the
visible rows is alarming unless the surface says why.

Each line is a Card with the Image, the name, priceLabel, quantityLabel and
lineTotalLabel. The spec fields exist on a cart line but are empty, so leave
them out rather than binding four blank Rows.

### Never

- Never invent an imageUrl or guess one from a product id. Bind the field, or
  leave the Image out.
- Never write a product value as a literal `text` string. "Out of stock",
  "$399" and "4.8 out of 5" are data. A literal is baked into the card template
  and therefore applies to every product in the list, including the ones it is
  wrong for.
- Never repeat the same value in two components of one Card.
- Never put a raw id (hp-001) in front of the user; ids are for tool calls.
- Never show a spec that is identical across every product on screen - it
  cannot help anyone choose.
"""
