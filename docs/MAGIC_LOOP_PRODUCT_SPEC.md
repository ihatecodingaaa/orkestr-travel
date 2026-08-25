# The Magic Loop — consumer product spec

**Plan together without doing the planning together.**

Everyone tells Orkestr what matters. Orkestr understands the group, asks only
what is missing, resolves what is compatible, turns inspiration into places,
builds a first plan, explains the decisions that matter, keeps private things
private, and when something changes repairs the smallest part of the trip.

    TELL → UNDERSTAND → INVITE → DISCOVER → PLAN → DECIDE → ADAPT

Orkestr is not a shared itinerary document, a CRUD planner, a chatbot, a
bookmark manager, or a static itinerary generator.

---

## 1. The problem this stage exists to fix

**The premade Tokyo example communicates the idea. A trip a real person creates
does not.**

That is not a styling problem. It is structural:

| | State | Screen |
| --- | --- | --- |
| Premade fixture | rich domain state | rich, intelligent UI |
| Real user trip | one traveller and an unread note | sparse UI |

The same components render both. The fixture simply arrives with something to
say. So the fix is not to redesign screens — it is to let a user-created trip
**accumulate real state through real interactions** until it has as much to say.

---

## 2. Reproduction — what actually happens today

Reproduced at 390px against a local production build, creating the founder's
scenario: **Beijing, 1–18 Sep 2026, organiser Luc**, notes *"8 of us are going in
total, 5 people in my family including me, 2 grandparents and 1 auntie."*

### 2.1 The headline defect

The note says eight people. The trip says:

> Beijing
> 1–18 Sep · **1 traveller**

`createTrip` (`core/trips/store.ts`) stores `notes` verbatim and creates exactly
one traveller — the organiser. **Nothing reads the note.** The form says so out
loud: *"Orkestr does not read it yet."*

A product whose first promise is "tell Orkestr what matters" must not discard
the first thing it is told.

### 2.2 The mobile form gap, and its root cause

`/new` is **1052px tall for five fields**. The two date fields alone occupy
**398px**.

Root cause, precisely:

```css
.field-row > .field { flex: 1 1 12rem; }      /* basis written for a ROW */
@media (max-width: 640px) {
  .field-row { flex-direction: column; }       /* axis flips, basis does not */
}
```

`flex-basis: 12rem` is a **main-axis** size. Once the row becomes a column the
main axis is height, so each field claims 192px:
`2 × 192 + 13.6 (gap) = 397.6px`. Measured: 398px.

### 2.3 Everything else found

| Area | Finding |
| --- | --- |
| Home | No "Your trips" surface. The wordmark returns to a marketing page. |
| Point of view | No screen says whose view it is. No actor name, no organiser badge. |
| Overview | "2 need a person" on a one-person trip. Ask placeholder clips mid-sentence. |
| New trip | Notes field declared inert in its own help text. |
| Explore | *"Saved as a link. Orkestr does not open or read it."* |
| Ask Orkestr | Accepts free text, answers a fixed local command list, and says so: *"This build answers a fixed set of questions locally — it is not connected to live Orkestr AI."* |
| Money | Zero totals presented as though they were figures; *"no server watching your trip."* |
| /understand | Provenance dominates; *"What actually ran"*, *"The fixture trip"*. |
| Navigation | No route back to Trips other than the wordmark. |

No horizontal overflow was found at 390px, and the trip nav did not clip at that
width — the crowding is visual density rather than truncation.

---

## 3. Point of view — decided once, applied everywhere

**One shared group trip, one personal view per member.** There is no group
account. Every member is always themselves, and their screen is:

    shared group state  +  their own private state

Grandma sees the group's plan and her own details. She never sees another
member's private values. There is no "view as" control in shared production,
because a control that changes who you are is an impersonation endpoint.

Every trip screen therefore states: **destination · your name · your role ·
your view**, and offers a way back to Trips.

---

## 4. Declared group size

A note saying "8 of us" means the trip involves eight people. It does **not**
mean seven fake members should be invented.

    8 travellers total
    1 named
    7 still to add

Never `Traveller 2`, `Traveller 3`. Capacity is a number the group declared;
people are created only when somebody names them.

Parsing is **bounded** — a small set of unambiguous phrasings, deterministic and
free, running before any paid model call. Ambiguity produces a question, never a
silent inference.

---

## 5. Honesty rules that survive this stage

Delight is not licence. The product may never claim:

* that it watched a video when it read a caption;
* that a price is live when it is recorded;
* that something is booked when nothing is booked;
* that everyone agrees when they have not been asked.

Technical truth stays in the product; it moves **down** the hierarchy rather than
out of it. "How Orkestr worked this out" is collapsed by default, never deleted.

---

## 6. Guarantees this stage must not regress

Shared Postgres as the source of truth · actor-resolved server views · private
values never serialised to other members · trip-scoped identity · hashed invite
and session tokens · optimistic concurrency and stale-write refusal · exact
source-span evidence · the semantic hard/soft policy · owner confirmation · no
model-authored quotations · deterministic travel groups, impact radius, plan
repair and decisions preserved · verified production TLS · server-only Model
Studio credential · recorded Atlas truth labels · no fake booking or availability
· local trips remaining usable with no account · the Tokyo example remaining
deterministic.

---

## 7. What this pass changed

Each verified at 390px against a production build, by creating the founder's
trip through the real form rather than reading the fixture.

| | Before | After |
| --- | --- | --- |
| A note saying "8 of us" | **1 traveller** | **8 travellers total · 1 named · 7 still to add** |
| Whose view it is | not stated anywhere | `Luc · ORGANISER · Your view`, on every trip screen |
| Way back | a wordmark | **← Trips** |
| `/new` height | 1052px, date row 398px | **844px**, date row 168px |
| Group total in Money | one person's share | everybody the group said was coming |
| Money with no estimates | two enormous zeros | **No estimates yet**, and what to do |
| Trip rules on Money | a wall of checkboxes | collapsed *How Orkestr handles changes* |
| `/understand` | provenance matrix above the input | answer first, machinery in a closed disclosure |
| Waiting 25s | a disabled button | what is running, and roughly how long |
| Sending an invite | copy to clipboard | the device's own share sheet, clipboard as fallback |

Consumer screens no longer say *"Orkestr does not read it yet"*, *"does not open
or read it"*, *"no server watching your trip"*, *"this build answers a fixed set
of questions locally"*, *"what actually ran"* or *"the fixture trip"*. Nothing
became less true — the Ask fallback still refuses and still lists what it can do,
and every provenance row still exists, one level down.

**No database migration.** `ConsumerTrip` is stored as JSONB, so
`declaredGroupSize` needed no schema change.

## 8. What the first pass did NOT do — and what happened next

All four were named as unbuilt. Three are now built and verified; the fourth was
measured and deliberately left alone. The original list is kept below.

### Now built

    SOURCE  →  PLACE  →  PLAN  →  ASK

**Source → Place.** A pasted link is fetched safely, read for what it says about
itself, and offered as a place to save. TikTok and YouTube through their own
anonymous oEmbed endpoints, ordinary pages through OpenGraph — **no new provider
credential**. Instagram is not pretended at: the link is kept and the person is
asked. The caption is the ceiling and the record says so; nothing in this build
can claim to have watched a video.

**Place.** A place is not a source. One source can name several places, one
place can be vouched for by several sources, and several people can save the
same place from different links. Deduplication merges only on an exact key with
nothing contradicting it, and asks otherwise — because two rows for one place is
untidy and fixable, while one row for two places sends the group to the wrong
restaurant.

**Plan.** "Build our first draft" proposes through the model and decides through
`validateDraft`, which refuses a place nobody saved, a day outside the trip, a
duplicate, a double-booked slot, and anything that would land on top of a FIXED
or BOOKED item. The model cannot invent a place because there is no field for a
name. Everything is labelled suggested; no opening time, travel time, ticket or
price has been checked.

**Ask.** The model picks one word from an allowlist this software owns. It never
names a function and never receives an id, so a misclassification costs a wrong
answer rather than a wrong action. Answers are computed from trip state by a
pure function; the only two things Ask can offer — a group-size change and a
draft — come back as a proposal with a button.

### Still not done

**Mobile navigation is unchanged.** Measured again at 390, 430, 768, 1024 and
1440: no horizontal overflow, no clipped tab bar. The crowding is density, not
truncation, and a rewrite was not made under the banner of fixing a defect the
evidence does not show.

---

## 9. The original list, kept



Named plainly, because a spec that lists them as done would be worth less than
no spec. Each is a stage in its own right:

1. **Ask Orkestr is still a fixed command set.** It no longer describes our
   architecture when it fails, but it does not yet reach the trip-aware tool
   layer (`read_group`, `propose_member_add`, `simulate_change` …). The
   expectation the input sets is still ahead of what it does.
2. **Link ingestion does not exist.** Explore still takes a link and a title
   from the person. No fetch, no provider adapter, no place extraction, no
   deduplication, no multi-source place cards. **This needs a provider
   checkpoint before it starts** — see below.
3. **There is no plan generation.** Plan remains manual. No *Build our first
   draft*, no readiness gate, no validation pass over a proposed itinerary.
4. **Mobile navigation is unchanged.** Measured at 390, 430, 768, 1024 and 1440:
   no horizontal overflow and no clipped tab bar anywhere. The crowding is real
   but it is density, not truncation, so a bottom-nav rewrite was not made under
   the banner of fixing a defect that measurement did not find.

### The provider checkpoint that blocks item 2

Reading a TikTok, Reel or YouTube link is not one feature. Each provider exposes
different things publicly, and the honest capability differs sharply:

* **TikTok** publishes an oEmbed endpoint for public video URLs giving title,
  author and thumbnail — **no key required**. Caption text is what it returns;
  it is not a transcript and the product must never say "Orkestr watched this".
* **Instagram** requires a Facebook app and an access token for anything beyond
  a bare link.
* **YouTube** exposes oEmbed without a key; captions need the Data API and a
  key, and most videos do not expose transcripts at all.

So a genuinely useful first version is possible **with no new credential** —
oEmbed plus OpenGraph, degrading honestly to "I opened the link but couldn't
tell which place you meant". Anything richer is a paid or keyed dependency and
must be a founder decision, not something a build quietly starts requiring.

## 10. Shared Magic Loop closure — the loop proven with two people

The previous two stages built link ingestion, first-draft planning and a real
Ask, and proved each of them **on one device**. That is a different claim from
the one the product makes. A group product that works alone is a demo; the
question this stage answers is whether the same three things behave when two
people are looking at one trip through one database.

### 10.1 What was actually run

Two isolated Chrome profiles — Luc (organiser) and Zen (traveller) — against
**the deployed product**, `https://orkestr-travel.vercel.app`, at a 390px mobile
viewport. One trip, created through the interface, never seeded.

(The same 22 checks were run first against a local production build on the same
production database, because Vercel's bot mitigation was briefly blocking the
deployment. It cleared, and the deployed run is the one recorded here.)

**22 of 22 checks pass**, plus a separate 5-check run for the stale-draft case:

| What was proven | Evidence |
| --- | --- |
| Luc creates a trip, adds Zen, converts it, invites her | invite link created, Zen joins in her own browser |
| Zen sees the place Luc saved from a link | `Temple of Heaven` on Zen's Explore |
| Zen saves a **second** link for the same place | **one card**, not two |
| The merge keeps both people | *"Luc and Zen saved this"* |
| The merge keeps both links | *"2 sources · en.wikipedia.org · britannica.com"* |
| A first draft is built from **shared** state and applied atomically | one version bump, 3 items |
| Zen sees the same plan | *"2 days have a shape"*, Luc's place on the day she opens |
| Ask answers the **organiser** from shared state | *"3 days are still empty"* |
| Ask answers a **traveller** too | *"2 things need someone"* |
| A generated item can be pinned | `FIXED` pill, *"1 locked in"* |
| Repair after a generated draft shows both halves | *"This would change"* / *"This would stay exactly as it is"* |
| Repair says what survives | *"2 of 4 things your group already agreed are staying · 1 new"* |
| The pinned item is in the untouched half | it appears under *stay exactly as it is* |
| Zen's private note is hers alone | absent from six of Luc's pages and from his Ask |
| A stale draft is refused **in words** | *"The trip changed while you were editing…"*, and `plan=0` |

### 10.2 The one product change this stage needed

A merged place said **"2 people saved this"**. That is a count, and the person
who saved the second link cannot find themselves in it — which is the one thing
they need to see, because from where they stand their save disappeared into
somebody else's card. With exactly two savers the product now names them:
*"Luc and Zen saved this"*. Three or more still count, because a list of names
would be longer than the place.

That is the whole of it. Everything else this stage set out to close was already
built; the work was proving it, and the honest report of that is §10.4.

### 10.3 A real limitation, found by trying to use it — since closed

**There was no way to add a new person to a trip that was already shared.**
Members were created by migration from the travellers a trip had when it was
converted, and never again. The Group screen listed who was there and offered
each of them an invite; it did not offer to add somebody new.

It was recorded rather than fixed at the time, because the missing part was not
a button — it was a decision about how somebody joining late reconciles with a
plan the group has already agreed. **That is now built and verified in
production; see §11.**

### 10.4 Seven things that looked like defects and were not

Recorded because each one cost a run, and because a report that lists only the
findings makes the process look cleaner than it was:

1. **A merged place also appears in the favourites strip** — precisely because
   two people saved it. Counting the words *"Temple of Heaven"* on the page
   counts the feature working as though it were the bug. Count cards.
2. **The plan opens on a day of its own choosing**, which may legitimately be
   empty. The day strip is what proves shared state, not whichever day happens
   to be selected.
3. **Ask has two answer surfaces.** `.ask-reply` is the deterministic answer;
   `.ask-answer` is the model-backed one. A traveller's question was answered
   correctly by the first, and a check that only knew about the second read it
   as silence.
4. **"Fix this" lives behind the row's *Edit* disclosure.** The button does not
   exist until the row is open.
5. **The `FIXED` pill is uppercased by CSS**, and `innerText` returns *rendered*
   text. A case-sensitive `/Fixed/` misses it.
6. **A requirement is shared unless "🔒 Keep it private" is ticked.** The first
   privacy run reported a leak on six pages; the database showed
   `"private": false`, which is the product doing exactly what it was told.
7. **Sharing takes two deliberate clicks** — "Make this shareable" opens a
   migration preview, and "Share this trip" is the decision.

## 11. Joining late — a shared trip stays open to membership change

**A shared trip is not a closed snapshot of whoever happened to be there when it
was converted.** People join groups late. Somebody's partner comes after all, an
auntie decides she is in — and a product that cannot express that forces the
group to start again somewhere else, which is the opposite of what Orkestr
promises when it says it adapts.

Joining late is not a reset. It is another change Orkestr coordinates.

### 11.1 The two events that are deliberately not one

Adding **Ryan** to the trip changes almost nothing. He has no dates, no
requirements and nothing to schedule around. Membership is not an impact.

It is when Ryan says *"I can only come from Wednesday"* that the plan acquires a
problem — so that is when the impact is computed, and not before. Conflating the
two would either fire a scary panel at the moment somebody is welcomed, or bury
the moment that actually matters.

### 11.2 The organiser knows things. That does not make them answers.

The organiser types *"He can only join from Wednesday"* because they are being
helpful, and because they probably are right. They are still guessing, and the
planner cannot tell a guess from an answer once it is in `availableFrom`: it
would build the week around Wednesday, tell the group Ryan is sorted, and be
wrong in a way nobody can see.

So the note is stored **beside** the traveller, never inside their availability:

* attributed — *"Luc added this before you joined"*, never an unowned statement;
* read into a day **only when the trip's own calendar makes it unambiguous** —
  one Wednesday in the trip means Wednesday, two means ask;
* accompanied by *"Nothing has been planned around this. It counts once you say
  so."*, which is literally true;
* removed the moment Ryan answers, either way. **Change it** is not a refusal to
  travel: it clears somebody else's guess and leaves the questions open, which is
  the honest state.

### 11.3 The declared size is asked about, never adjusted

A trip that says *"2 people in total"* and gains a third named person has two
numbers that disagree. Quietly raising the total would be Orkestr inventing
capacity — exactly what `readGroupSize` refuses to do everywhere else. So it
asks, once, at the moment the two stop agreeing:

> You said 2 people in total. Adding Ryan makes 3.
> **[ Yes, 3 ]**  Someone else is dropping out

Replacement is deliberately left as a question. Somebody dropping out is a
decision with consequences for the plan, so it is sent to What-if — which shows
those consequences — rather than becoming a second, quieter way to remove a
person.

### 11.4 What the group is shown when the answer arrives

Every number is calculated by the preview engine What-if already uses, run over
a counterfactual with the arrival taken back out. From the verified production
run:

> **RYAN IS JOINING FROM WEDNESDAY 2 SEP**
> 1 thing may need to change.
> 2 of 3 earlier decisions can stay · 1 new decision
>
> **Affected** — Everyone together — now Wednesday 2 Sep
> **Unaffected** — Tuesday: Temple of Heaven, Qianmen Street · Wednesday: Jingshan Park
>
> **Ryan arrives after 1 thing you have fixed**
> 🔒 Tuesday 1 Sep: Temple of Heaven
> Orkestr will not move it. Either Ryan joins after it, or the group reconsiders
> it on the plan.

Three properties worth naming:

1. **The denominator is what was decided BEFORE.** A travel group that exists
   only after Ryan arrives is a *new* decision, counted separately and never
   called preserved. This was a real defect: such a group used to land in
   "changed", so a late join made the ratio worse for doing nothing wrong.
2. **Nothing is regenerated.** The plan is not rebuilt around the new arrival;
   what-if changes who travels when, not what is on the itinerary.
3. **A fixed item is never moved to make somebody fit, and never passed over in
   silence either.** The collision is stated with both honest options, and both
   belong to the group.

### 11.5 Ask reaches the same door

*"Ryan is joining us from Wednesday"* proposes; it does not act:

> **Add Ryan to the trip?**
> They'll get their own invite and their own view.
> Anything you've said about them is kept as your note until they confirm it.
> **[ Add Ryan ]**  Not now

The button calls the same shared action the Group screen calls. There is no
Ask-only path onto a trip's membership, the server still checks that the asker
is the organiser, and it still refuses a stale version. A name the model returns
is kept **only if it appears in the question** — "add my auntie" has no name in
it, and the useful answer is to ask rather than to invite somebody called Auntie.
