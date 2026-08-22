# Manual QA checklist

**For the founder to run.** No browser automation is installed in this
repository, and Phase 9 deliberately did not add a browser stack just to click
six pages — that would be a large dependency for a one-time check.

What *was* verified automatically: a real production build, a real server, and
every route returning 200 with content assertions on the hero page. What only a
human can check is what it looks like.

If anything here fails, report it. Do not hand-edit files.

---

## Setup

```bash
npm run build
npm run start          # http://localhost:3000
```

Open a clean browser window with the console visible.

## 1. Home

- [ ] `/` loads
- [ ] The provenance board shows **several different sources**, not one "LIVE" badge
- [ ] Rows reading `LOCAL FIXTURE` and `NOT CONNECTED` are visible, not hidden

## 2. The hero page, before anything changes

- [ ] `/demo/agent` loads
- [ ] First readable line is **Orkestr Travel · the coordination agent for group journeys**
- [ ] Headline reads **Nothing has changed yet**
- [ ] Demo controls visible: Reset · Ryan joins · Check the fares
- [ ] Nothing looks broken above the fold

## 3. The change

- [ ] Click **Ryan joins**
- [ ] Headline becomes **Plan repaired**
- [ ] **What changed** names Ryan
- [ ] **What this affected** lists the Wednesday group
- [ ] **What stayed exactly as it was** lists the Tuesday group
- [ ] **Earlier decisions kept** reads `10 of 10`
- [ ] Note reads *"Nothing already agreed had to be undone · 1 new decision added"*
- [ ] **Whole-trip rebuilds** reads `0`
- [ ] **Steps used** reads `5 of 7`
- [ ] The step-by-step list is numbered and reads as plain English

## 4. The private decision

- [ ] Click **Check the fares**
- [ ] Headline becomes **Needs one person's decision** — NOT a success message
- [ ] Go to `/demo/decisions`, then the affected traveller's participant page
- [ ] The private figure appears ONLY on that person's page
- [ ] The group view shows the category, never the amount

## 5. Failure states

- [ ] `/demo/agent?stage=RYAN_JOINED&fare=UNAVAILABLE` loads without crashing
- [ ] It does NOT say complete, done, repaired or success
- [ ] `/demo/agent?stage=RYAN_JOINED&fare=HARD_BREACH` loads and reads honestly

## 6. Reset

- [ ] Click **Reset**
- [ ] Back to *Nothing has changed yet*
- [ ] The URL has no query string
- [ ] Clicking **Ryan joins** again produces **the identical numbers**

## 7. Technical drawer

- [ ] **Technical detail** expands and collapses
- [ ] Keyboard-reachable with Tab; opens with Enter or Space
- [ ] Shows the terminal status and the step sequence

## 8. Console and network

- [ ] **No errors** in the console
- [ ] No hydration warnings
- [ ] No React key warnings
- [ ] No 404 for any asset
- [ ] Network tab shows **no outbound request to any provider**
- [ ] No secret visible in page source or network responses

## 9. Sizes

Resize or use device emulation:

- [ ] 1440px — comfortable
- [ ] 1280px — comfortable
- [ ] **1024px — must still look excellent**
- [ ] 768px — usable, nothing clipped
- [ ] 390px — usable, no horizontal scrolling, the fact grid reflows

## 10. Accessibility spot check

- [ ] Tab through the page; focus is always visible
- [ ] Every control is reachable by keyboard
- [ ] Status is conveyed by **words**, not colour alone
- [ ] Headings descend in order without skipping a level
