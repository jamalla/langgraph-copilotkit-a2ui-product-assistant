# Four levers on generated UI

> How to make agent-generated A2UI surfaces follow our design system, and which
> of the four controls the model can quietly ignore.

Audience: frontend. Package: `@a2ui/kit`.

---

## The one idea

A second language model designs the surface on every turn. It is not our code,
we do not review it, and it can differ between two identical questions. The
instinct is to write a longer prompt. That is the weakest of the four tools
available, and reaching for it first is why generated UI ends up looking
arbitrary.

Rank every control by one question: **can the model ignore it?**

| Lever | Lives in | Controls | Can it be ignored? |
|---|---|---|---|
| Component catalog | runtime config + your React | Which components exist at all | Never |
| CSS | `a2ui-theme.css` | Colour, radius, type, layout | Never |
| Data shape | `a2ui.py` | What values can appear | Never |
| Prompt | `design_rules.py` | Structure and ordering | **Often** |

**Rule of thumb.** If you can express it in CSS, do it in CSS. Asking the model
for "three to five cards per row depending on width" is a wish: it emits a tree,
cannot see the chat width, and cannot re-decide when someone drags the resizer.
`repeat(auto-fill, minmax(168px, 1fr))` is a fact.

---

## Lever 1: CSS (deterministic)

`packages/a2ui-kit/src/styles/a2ui-theme.css`

This is where visual consistency actually comes from, and the file you will
spend most of your time in. The A2UI renderer reads exactly eight CSS custom
properties. We map every one to a token that already exists in the app:

```css
.a2ui-surface {
  --background:         var(--surface);
  --foreground:         var(--ink);
  --card:               var(--surface);
  --border:             var(--line);
  --input:              var(--line-strong);
  --primary:            var(--brand);
  --primary-foreground: var(--brand-ink);
  --radius:             12px;

  font-family: var(--font-sans);
  color: var(--ink);
}
```

Two properties of that block matter more than its contents.

**There is not one hard-coded colour in it.** Every value references an app
token, so a generated surface follows our light and dark themes automatically.
Change `--brand` in `globals.css` and every future surface follows, with no
agent change and no redeploy of the Python side.

**Everything is scoped to `.a2ui-surface`.** None of it leaks out, and nothing
leaks in by accident.

### The tokens you are mapping onto

Defined in `apps/web/app/globals.css` under `@theme`. This is the vocabulary. A
generated surface should end up pointing at one of these rather than at a new
hex value.

```
colour:  --color-canvas   --color-surface    --color-surface-2
         --color-line     --color-line-strong
         --color-ink      --color-ink-muted  --color-ink-faint
         --color-brand    --color-brand-ink
         --color-positive --color-warning    --color-danger

shape:   --radius-card: 14px   --radius-control: 9px   --radius-pill: 999px
         --shadow-card         --shadow-float
```

### Eight variables is not the whole file

The variables cover the common case. The rest of `a2ui-theme.css` exists because
the shipped catalog does things no variable can reach, and because layout is our
decision rather than the model's:

- **Layout.** The generated `List` becomes a responsive grid. The column count
  is never stated, so the browser fits as many as the width allows and reflows
  on resize.
- **Images.** Full bleed across the card, fixed 4:3, `object-fit: cover`. The
  model picks the image, we decide how it sits.
- **Overflow.** Tables and wide rows scroll inside the surface instead of
  stretching the chat window.
- **Inline-style overrides.** See the trap below.

> **Trap: inline styles beat your variables.**
>
> The basic catalog sets some colours as inline styles, for example
> `style="color: rgb(102, 102, 102)"` on captions. No custom property can reach
> those, and they look wrong in dark mode. We override with attribute selectors:
>
> ```css
> .a2ui-surface small,
> .a2ui-surface [style*="rgb(102, 102, 102)"],
> .a2ui-surface [style*="#666"] { color: var(--ink-muted) !important; }
> ```
>
> This is a substring match on someone else's inline styles, so it is fragile by
> design. If captions look grey and dead in dark mode after a CopilotKit
> upgrade, look here first.

> **Trap: Tailwind does not scan the package by default.**
>
> `@a2ui/kit` lives outside `apps/web`, so Tailwind will not find its classes
> and silently generates none of them. Components then render completely
> unstyled, which looks like a broken component and is really a build-scope
> problem. One line in `globals.css` prevents it:
>
> ```css
> @source "../../../packages/a2ui-kit/src";
> ```
>
> We lost real time to this once. A `size-6` button measured 11 by 19 pixels,
> and every check that asked "is the element present?" passed.

---

## Lever 2: the data shape (deterministic, and the strongest)

`apps/agent/src/agent/a2ui.py`, `display_product()`

The strongest lever and the least obvious. It decides what the model is *able*
to put on screen.

An A2UI binding **points at** a value. It cannot format one, join two together,
or choose between them. The house style used to ask for "prices as $279" and
"brand and rating on one line". Neither is expressible as a binding, so the
model approximated: a bare `229` with no currency symbol, the brand bound with
the rating silently dropped, and a literal "Out of stock" baked into the card
template, which then rendered on *every* product in the list including the ones
in stock.

The fix was not a firmer prompt. Every string a card can display is now
precomputed as a flat top-level field:

```json
{
  "name":       "Aether NC 900",
  "priceLabel": "$399",
  "brandLine":  "SONARE - 4.8 out of 5 - 4.1K reviews",
  "stockLabel": "In stock",
  "imageUrl":   "/products/hp-001.jpg",
  "spec1Label": "Battery",
  "spec1Value": "32 h"
}
```

The model cannot render `229` instead of `$399`, because it never sees a raw
number. It binds, or it has nothing to bind.

The half people miss: we also **deleted** `specs` and `price` from the payload.
Not discouraged in the prompt, removed. A nested path such as `specs/type`
inside a `List` template resolves to nothing and the card renders blank with no
error anywhere. Removing the field made the mistake impossible rather than
merely forbidden.

> **The principle worth carrying to other work.** Constraining what the model
> can say beats telling it what to say. A rule can be missed. A missing field
> cannot be bound. When output is inconsistent, ask what the model would have to
> be able to see in order to get it wrong, and take that away.

---

## Lever 3: the prompt (influential, not guaranteed)

`apps/agent/src/agent/design_rules.py`, `HOUSE_STYLE`

The only lever that can express intent about *arrangement*: image first, then
name, then price, then the caption. CSS cannot say that, and the component
catalog does not care.

It is passed as `composition_guide` and **appended** to A2UI's built-in
guidelines rather than replacing them. That matters: the defaults carry protocol
constraints the surface will not render without, such as exactly one component
with `id: "root"` and relative paths inside `List` templates. Replacing them
wholesale produces surfaces that fail validation.

**What belongs here**

- Component choice: cards rather than a table for product results.
- Order within a card.
- Prohibitions: never invent an `imageUrl`, never show a raw product id.
- Semantic judgement: never show a spec that is identical across everything on
  screen, because it cannot help anyone choose.

**What does not belong here**

Anything the model would have to *compute*. If you find yourself writing a rule
that asks it to format, join, or branch on a value, the rule will not hold. Add
the field to `display_product()` instead and let the rule say "bind this".

---

## Lever 4: the component catalog (the hard constraint)

`apps/web/app/api/copilotkit/[[...rest]]/route.ts`

The lever we are *not* currently using, and the honest answer to "how do I stop
it looking random".

We run the **dynamic** schema. The runtime is configured with `a2ui: {}`,
meaning no catalog is supplied and a second model invents the component tree on
every turn. That is why two similar questions can produce slightly different
layouts.

The alternative is a **fixed catalog**: you write `ProductCardA2` and
`CompareTableA2` as real React components with zod schemas, register them, and
the agent streams only *data* into them. The layout is then yours, permanently.

| | Dynamic (what we run) | Fixed catalog |
|---|---|---|
| Who designs the layout | A second model, per turn | You, once |
| Visual consistency | High, not guaranteed | Identical every time |
| Latency and cost | A second model call per turn | None |
| A surface type we did not anticipate | Handled for free | You build the component |
| Styling effort | Tokens plus defensive CSS | Ordinary React styling |

**Recommendation.** Keep the dynamic schema, because watching the model design a
tree is the point of this project, and add a fixed catalog for the two surfaces
that must never vary: the product card and the comparison table. A2UI supports
mixing them. You get determinism where a customer would notice, and keep the
demonstration where it teaches.

---

## Adding a token, end to end

Say we introduce a "sale price" treatment. The work is not in the prompt.

1. **Define the token in the app.** Add `--sale` to the light block in
   `globals.css`, then to both dark blocks: the `prefers-color-scheme` one
   guarded as `:root:not([data-theme="light"])`, and the
   `:root[data-theme="dark"]` one. Expose it under `@theme` as `--color-sale`. A
   colour defined only inside a media query is the classic unreadable-theme bug.
2. **Map it for the surface.** In `a2ui-theme.css`, add a rule under
   `.a2ui-surface`. If the renderer has no variable for the concept, target the
   element instead. Never write a hex value here.
3. **Give the model something bindable.** Add `salePriceLabel` to
   `display_product()`, already formatted, and an empty string when there is no
   sale so it can be bound unconditionally. An empty `Text` renders as nothing.
4. **Only now, the prompt.** Add one line to `HOUSE_STYLE` naming the field and
   where it goes. If steps 1 to 3 are right, this is the least important of the
   four.
5. **Verify in the browser, not in the diff.** Ask a question that produces the
   surface and look at it. Every failure in this stack is silent: correct-looking
   output, no error, no stack trace.

---

## When a surface looks wrong

Diagnose in this order, roughly cheapest to most expensive.

| Symptom | Where it lives |
|---|---|
| Wrong colour, spacing, radius or font | CSS. Deterministic, so it is our bug, not the model's. Check whether an inline style is beating the variable. |
| Completely unstyled, as though no CSS loaded | Tailwind scope. Confirm the `@source` line still covers the package path. |
| Wrong or unformatted value, a bare number, a caption wrong per card | The data shape. Fix `display_product()`, then consider removing whatever it bound by mistake. |
| A field is blank with no error | Almost always a nested path inside a `List` template. Those resolve to nothing, silently. The field must be flat and top level. |
| Right values, wrong arrangement | The prompt. Before rewriting it, ask whether CSS could enforce the same thing. |
| Nothing renders, or the panel says "failed" | Not styling. Open "How this UI was generated" in the chat and read the error. |

> **Grep footgun.** A `focus-visible` utility appears in the built stylesheet as
> `focus-visible\:outline-brand`. Grep for the escaped form or you will conclude
> a rule is missing when it is present.

---

## Before you ship a change

- Both themes checked, including the un-stamped system default. Three viewer
  states exist, not two.
- No hex values in `a2ui-theme.css`. Every colour points at a token.
- Nothing added to `HOUSE_STYLE` that asks the model to compute.
- Long content still scrolls inside the surface rather than widening the chat.
- Looked at it in the browser at two chat widths, since the grid reflows.

> **The sentence to remember.** Style the surface with CSS, constrain the values
> with the data shape, and use the prompt only for what neither of those can
> express. If a rule is load bearing, it is in the wrong lever.

---

Files referenced: `packages/a2ui-kit/src/styles/a2ui-theme.css`,
`apps/web/app/globals.css`, `apps/agent/src/agent/a2ui.py`,
`apps/agent/src/agent/design_rules.py`,
`apps/web/app/api/copilotkit/[[...rest]]/route.ts`.
