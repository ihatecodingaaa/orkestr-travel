# Demo Script

**Status:** `IMPLEMENTED` for the local build. Every screen below exists and
runs offline with `npm run dev`.

**Everything is LOCAL FIXTURE data.** No airline, no web search, no AI. The
banner at the top of every screen says so, permanently, and is not a tooltip.

---

## Before you start

```bash
npm install
npm run dev          # http://localhost:3000
```

The demo is driven by the URL, so every step is a real navigation and the back
button works as undo. Any point can be reached directly if something goes wrong:

| Step | Address |
| --- | --- |
| Baseline | `/demo` |
| After Ryan joins | `/demo/waves?stage=RYAN_JOINED` |
| Fare rise past a preference | `/demo/journey?stage=RYAN_JOINED&fare=SOFT_BREACH` |
| Fare rise past a hard limit | `/demo/journey?stage=RYAN_JOINED&fare=HARD_BREACH` |
| A private view | `/demo/participant/T-006?stage=RYAN_JOINED&fare=SOFT_BREACH` |

The same address always produces the same screen. Nothing is random and nothing
reads a clock.

---

## The three-minute sequence

### 0:00 - The problem (20 seconds)

Open `/`.

> "Six people want five days in Tokyo. They live in different places, they are
> free on different days, one of them needs step-free access and travels with her
> husband. The usual answer is a group chat that never resolves."

Point at the disabled text box.

> "Reading free text isn't built yet, so this build says so rather than
> pretending. Everything here comes from a structured demo fixture."

Click **Load the family demo**.

### 0:20 - Who is going (25 seconds)

`/demo`

> "Six of seven expected travellers have joined. Notice what the group can see:
> that somebody has a budget requirement, not what it says. Personal figures stay
> with their owner."

Point at Gita's card.

> "She has stated she needs step-free access. Two separate badges: she has
> confirmed the requirement, and the airline has confirmed nothing. Those are
> different facts and the interface never merges them."

### 0:45 - The split (40 seconds)

`/demo/waves` - **the signature screen.**

> "One flight doesn't work for everyone. So Orkestr doesn't give up; it finds the
> smallest split that does."

```
Wave A   Tue 25 Aug   Ama, Bo, Cai
Wave B   Wed 26 Aug   Gita, Elias, Nadia
         Everyone together from Wed 26 Aug, 17:00
```

> "Gita and Elias are together because she said she needs to be with him. Not
> because they share a surname."

Point at **Why this works**.

> "Every line is derived from the planning result, not written by a model. Two
> groups rather than three. Everyone together within 24 hours. And one line
> that's still open: the airline hasn't confirmed the assistance."

Scroll to the return leg.

> "And they don't all come home together. The return is planned separately, so
> the two groups fly out and one group flies back."

### 1:25 - The whole journey (30 seconds)

`/demo/journey`

> "Day one only has three people on it, and the interface says so. Nothing for
> the whole group is scheduled before everybody has landed."

Point at a demo-assumption label.

> "Airport timings are labelled as demo assumptions, because how early you need
> to arrive genuinely varies. We're not going to invent a number and present it
> as an airline rule."

### 1:55 - Ryan joins (35 seconds)

Click **Ryan joins**.

> "Ryan joins after all of this was agreed. Watch what does NOT happen."

```
Wave A   unchanged
Wave B   + Ryan, same flight
10 of 10 existing flight decisions stayed intact
1 new decision was added
```

> "Wave A is untouched. Those three people are never asked anything. Ten of ten
> existing decisions survived, and one was added for Ryan."

> "And it says Wave B needs re-checking. Ryan fits that flight's requirements.
> Whether a seat exists, nobody has checked, and we don't claim otherwise."

### 2:30 - The fare moves (20 seconds)

Click **Check the fares**.

> "The fare went up by thirty dollars. That crosses one traveller's preferred
> budget."

> "The group is told that one traveller would need to stretch a preference. It is
> not told who, and it is not told the number."

Open the private view.

> "Only she sees this: thirty dollars above her preferred budget, four-thirty
> normally, four-sixty for this trip. And her usual preference is not changed by
> accepting. It's recorded as an exception, not an overwrite."

### 2:50 - What still needs a person (10 seconds)

`/demo/decisions`

> "Orkestr prepared thirty-two journey items. Seven things still need a human or
> an airline. That's the product: it absorbs the complexity and hands back the
> decisions."

---

## What a judge should take away

1. **It doesn't give up.** No single flight works, so it finds the smallest split
   that does.
2. **It changes as little as possible.** A late joiner costs three people
   nothing.
3. **It never overstates.** Nothing is booked, nothing is verified, no seat is
   claimed, and assistance is not confirmed just because somebody asked for it.
4. **Privacy is structural.** The group learns the effect; only the owner learns
   the detail.
5. **Nothing here is AI.** Every decision is deterministic and tested. Qwen
   arrives in Phase 6 to read language and gather evidence, not to make these
   judgements.

---

## What is NOT in this demo

Real flights. Real prices. Real availability. Any airline. Any web search. Any
language model. Any account or login. Any saved data. Any booking or payment.

Later phases replace the fixture provider with Atlas and add Qwen for extraction
and research. Until then, the banner tells the truth on every screen.
