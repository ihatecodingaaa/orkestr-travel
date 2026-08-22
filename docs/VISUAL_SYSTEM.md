# The Orkestr visual system

Stage 2 made the product interactive. It still looked like a structured
productivity dashboard: white containers, thin outlines, serif headings on
everything, and eighteen identical empty days.

This is what the interface is made of now, and why each decision was made.
Every rule here exists because breaking it produced something worse on a screen
somebody looked at.

---

## The one idea

**Containers differ by job.** A hero is a hero, a stat is a number, a day is a
timeline, an idea is a card, a suggestion is a row, a scenario is a button.
Rhythm comes from that variety, not from more borders. Eight identical rounded
rectangles stacked vertically reads as a form, whatever is written inside them.

## Typography

Two families, and the split is by **role**, not by size.

| Role | Family | Where |
| --- | --- | --- |
| Destination, moments, hero statements | `--font-display` (serif) | Trip title, hero, day heading, featured place, milestones |
| Everything interactive or structural | `--font` (sans) | Navigation, buttons, forms, cards, lists, metadata, status, timeline |

The serif was previously on every `h2` and `h3`, which meant "Saturday group"
and "Most wanted" carried the same editorial weight as the name of the city.
When everything is emphasised, nothing is.

**Section labels are sans, small, uppercase, tracked** — `.strip-title`. They
name a region without competing with its contents.

## Colour

Roles, not decoration. Defined once in `:root`, never per component.

| Token | Role |
| --- | --- |
| `--brand` | Orkestr's own colour. Primary actions, the active tab, save state |
| `--sky` | The secondary voice: what-if, flights, informational surfaces |
| `--wave-a/b/c` | Travel groups. Group identity only |
| `--cat-*` | The seven idea categories |
| `--tone-verified / pending / alert / unknown` | Truth states, with matching `-bg` |
| `--paper / -raised / -sunken` | Background, elevated surface, recessed surface |
| `--ink / -soft / -faint` | Text, secondary text, metadata |
| `--line / -strong` | Borders |

**Colour is never the only signal.** Day fullness has a dot *and* a visually
hidden label. Travel groups have a colour *and* a name. Truth states have a
colour *and* a word.

### Destination identity

A trip should feel like its destination. There is no image service in this
build, and one was not added for decoration — a remote image host is a new
external dependency, a new failure mode and a licensing question, all for a
backdrop.

So the hero is **drawn**: a map-grid pattern, a dashed route with two stops, and
one of six palettes chosen by hashing the destination name. Deterministic,
offline, about two kilobytes, and stable — Seoul is always the same Seoul, on
every device, with nothing stored.

The palette is **decorative only**. It means nothing, so nothing is lost on a
reader who cannot see it, and nothing is claimed about the place. Picking "warm"
for Seoul would be inventing a fact about Seoul.

## Spacing

One scale: `--space-1` `0.5rem`, `--space-2` `1rem`, `--space-3` `1.5rem`,
`--space-4` `2.5rem`. Sections use `gap-3`; content inside a section uses
`gap-2` or `gap-1`. Page width stays at `1080px` — a reading measure, not the
window width.

## Cards

Before adding a card, the question is whether the thing needs one.

**Card**: an idea, a person, a travel group, a featured place — something with
its own identity and its own actions.

**Not a card**: a plan item (a timeline row), a suggestion (a row), a decision
(a bordered list item), a day (a panel), a stat (a tinted block).

The plan used to wrap every item in a bordered card inside a bordered day inside
a bordered list. Three nested borders to say "09:15 flight".

## Motion

Subtle, and only to confirm something happened.

| Where | What |
| --- | --- |
| Adding to a day | A short confirmation line fades in |
| Milestone | Rises 4px on appear |
| Cards, chips, suggestions | 1–2px lift on hover |

No fake typing, no artificial loading, no confetti. Everything is behind
`prefers-reduced-motion: reduce`.

## Responsive

| Width | Behaviour |
| --- | --- |
| 1440 | Full grids; content stays at 1080px rather than stretching |
| 1024 | Card grids reflow via `auto-fit` / `auto-fill` |
| 768 | Two-column sections stack |
| ≤640 | Fixed-track grids collapse; timeline drops its time gutter; stats go two-up |
| ≤430 | Navigation tightens so all six destinations fit without a sideways swipe |

**One navigation row.** What-if, Money and Activity used to sit on a second row
beneath the first, which read as leftover utilities and cost a whole line of
vertical space on a phone before anything about the trip appeared. They are
behind **More** now, and What-if is additionally promoted as an action on the
Overview, because showing what a change would break is the thing a shared
document cannot do.

## Two collisions worth remembering

Both cost real time, and both had the same shape: **one class name doing two
jobs.**

* `.timeline` — the Stage 1 demo styles `.timeline li` at specificity (0,1,1),
  which silently beat `.plan-row` and forced every title into a 4.5rem column,
  one word per line. The product's list is `.day-timeline` now.
* `.chip` — the demo's status label sets `text-transform: uppercase`, so every
  suggested question in the command bar SHOUTED. The demo's is `.state-chip`
  now; `.chip` is the interactive control.

If a new class name already exists in `globals.css` or `product.css`, it belongs
to the demo layer. Pick a different one.

## What visual polish may never do

Presentation improves; **truth does not move**. Nothing here hides "not
verified", "unknown", "local example", "recorded provider", "private" or
"tentative". Where a caution was repeated identically on six cards it moved to
one statement at the top of the section — the same fact, stated once, more
likely to be read.
