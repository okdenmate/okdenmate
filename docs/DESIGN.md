# Design profiles

## The question this settles

Layer 9 of the brief adopts one visual system across Reeve Wood and UK Nitrates,
and is admirably honest about why: the two businesses share no customers, so a
shared palette is **not** a brand-equity play. It is a production-cost play. One
token set means the second and third pages cost a fraction of the first.

It then flags the consequence and marks it unresolved:

> the treatment is deliberately loud. reevewood.com's architect-facing pages are
> restrained. If both run simultaneously the group presents two identities.
> **UNKNOWN**: resolve by (a) new treatment for direct-buyer pages only, muted
> variant for architect pages; or (b) full site migration.

There is a third thing worth naming, which the brief does not: the shared
palette is not neutral ground. Its warm dark timber and its brand sage
`#8C9839` are **Reeve Wood's own colours**, recorded in Layer 3 as that site's
palette. Extending them to a nitrate distributor is not adopting a group
identity. It is dressing one business in another's.

So the resolution here is neither (a) nor (b). The token set became a
**profile**. Both are complete, both are validated, and switching costs one
attribute. The production-cost argument survives intact, because the component
vocabulary, the funnel pattern and every rule below are shared; only the colour
roles differ.

## The two profiles

| Role | `group` | `ukn` (default) |
|---|---|---|
| Ground | `#151109` warm dark timber | `#0C110E` cold, faint green cast |
| Text | `#F4EFE2` | `#E9EFEA` |
| Secondary | `#B3A98F` | `#95A69B` |
| Tertiary | `#867C66` | `#76877C` |
| Accent | `#CBE93F` lime | `#3FE0C8` chemical cyan |
| Accent ink | `#171200` | `#00201B` |
| Field one | `#8C9839` sage | `#2E6F8E` blue |
| Field two | `#E8B45C` amber | `#5F8A3E` fen green |
| Hazard | — | `#FFD400` |

Measured against the UK Nitrates ground: text 16.3:1, secondary 7.5:1, tertiary
5.0:1, accent 11.5:1, dark ink on the accent 10.4:1. All pass AA for body text.

### Why cold, and why cyan

The ground is cold with a faint green cast — fen peat rather than sawn oak. It
is the shortest way to stop the application reading as a hardwood workshop.

The accent is a bright chemical cyan rather than the obvious choice. Hazard
yellow would have been the obvious choice: every product in the catalogue is UN
Class 5.1 Oxidising, so it is a material fact about the business rather than a
decoration. It was rejected for a specific reason. This application's signature
screens are compliance screens, and they are full of amber warning chips. An
accent that reads as caution stops being the one thing on the screen that
catches the eye, which is exactly what the contrast-economy rule exists to
protect.

The cyan sits at OKLCH lightness 0.82, far outside the 0.48–0.67 band the three
status colours occupy, so a call to action can never be mistaken for a warning.

Hazard yellow is still used, but for one thing only: marking a product as UN
Class 5.1. No status ever borrows that token.

## Rules that do not vary by profile

These come from Layer 9 and hold in both:

- **No mid-tone text on a dark ground.** Every colour is checked against its
  ground before use, and the measurements are recorded in the stylesheet.
- **Contrast economy.** The accent appears at most twice per viewport: the
  primary action, and the single number the screen exists to deliver. Everything
  else sits in muted translucency. That is what makes the call to action
  unmissable without a shadow, a bevel or an animation.
- **Depth from blur and translucency**, never an offset shadow or a bevel.
- **Two diffuse fields per screen**, behind the primary interactive object and
  behind the result. Not behind everything.
- **Film grain** across the viewport, which is what stops large soft gradients
  reading as cheap.
- **One orchestrated moment on load**, nothing on scroll, and
  `prefers-reduced-motion` respected.

Component CSS refers only to role tokens — `--accent`, `--field-1` — and never to
a colour by name. That is what makes a profile a swap rather than a rewrite.

## Charts are not brand colours

The chart palette does not change between profiles, and must not be swapped for
brand colours. Its separation was measured against these exact backgrounds for
lightness, chroma, contrast and colour-vision separation.

| Slot | Colour | Use |
|---|---|---|
| Categorical 1 | `#3987e5` | Specialty |
| Categorical 2 | `#d95926` | Commodity |
| Sequential | `#2563ab` → `#8bbcf1` | Funnel stages, scenario bands |
| Status | `#199e70` / `#c98500` / `#e0405a` | Good / warning / critical |

Categorical is deliberately **two** slots. The only categorical split in this
system is commodity against specialty, and two well-separated hues beat four
badly separated ones. Ordered data uses the sequential ramp instead.

The status green and red cannot be told apart under deuteranopia, which roughly
one man in twelve has. Every status chip therefore carries a glyph and a word.
Colour is never the only signal, and that is not negotiable.

## Switching

In the application, the sidebar carries a profile switch. The choice is stored
per browser and stamped on `<html>` before React mounts, so nothing paints in
the wrong palette.

On the website, the widget takes the same profile:

```html
<script src="…/ukn-enquiry.js" data-profile="ukn" data-surface="dark"></script>
```

Both profiles have a light surface variant for a page not ready to carry a dark
panel. A bright accent that works on a dark ground fails as a background for
dark ink on a light one, so each profile names its own light-surface accent
rather than reusing the dark value.

## What to tell Tom

The production-cost argument was the reason for one system and it still holds:
the components, the funnel and the rules are shared, and a third page still
costs a fraction of the first. What has changed is that UK Nitrates no longer
wears Reeve Wood's colours by default, and the group treatment is one attribute
away whenever it is wanted. The decision that was marked UNKNOWN can now be made
by looking at both rather than by arguing about either.
