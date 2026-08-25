# Production acceptance

What must be true of the public deployment before it counts as working. Every
check is something observed, not something reasoned about.

**Use synthetic travellers only.** No real names, no real dates, no real budget
figures. The sentinel below is a made-up number in made-up data.

---

## 1. Reachability

- [ ] The production URL serves `/` over HTTPS
- [ ] `/new`, `/examples/tokyo-family`, `/sources` all load
- [ ] `/robots.txt` disallows `/join/` and `/trip/`
- [ ] A trip page carries `noindex`
- [ ] An invite page carries `noindex` **and** `referrer: no-referrer`

## 2. Security headers

On any page:

- [ ] `Referrer-Policy: strict-origin-when-cross-origin`
- [ ] `X-Content-Type-Options: nosniff`
- [ ] `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`
- [ ] `Permissions-Policy` denies camera, microphone, geolocation, payment, usb
- [ ] `Strict-Transport-Security` present
- [ ] **No** `X-Powered-By`

## 3. The full group flow, two isolated browsers

**A** = organiser, **B** = Zen. Separate profiles, separate cookie jars.

- [ ] A creates a local trip and makes it shareable
- [ ] A is warned that other people's details become drafts
- [ ] A copies Zen's invite; **no token is visible anywhere on the page**
- [ ] B opens the link and sees who they are joining as
- [ ] B opens it **twice** — it is not consumed by being viewed
- [ ] B joins; the token disappears from the URL
- [ ] The link now refuses reuse
- [ ] B is walked through onboarding, and organiser-entered details are labelled
      *filled in before you joined*
- [ ] B has **no** traveller picker
- [ ] B sets availability, saves an idea, and adds a **private** requirement
      containing the sentinel

## 4. Privacy, on the deployed site

The sentinel must be **absent** from A's and any other traveller's responses,
and **present** only for its owner, on every one of:

Overview · Explore · Plan · Group · Inbox · Money · Activity · What-if

Check **both** the HTML and the RSC payload:

```
curl -s -H "cookie: orkestr_session=<A's>" "<url>/trip/<id>/group"
curl -sL -H "cookie: orkestr_session=<A's>" -H "RSC: 1" "<url>/trip/<id>"
```

- [ ] **Assert the response is real first** — it contains the destination and is
      more than a redirect. A check against an empty body proves nothing, and
      has passed vacuously here before
- [ ] Sentinel absent for every non-owner
- [ ] Sentinel present for the owner
- [ ] A is still told a private requirement **exists**

## 5. Cookies, over real HTTPS

Inspect in a browser, not a unit test:

- [ ] `HttpOnly`
- [ ] `Secure`
- [ ] `SameSite=Lax`
- [ ] Bounded expiry, path `/`
- [ ] `document.cookie` does not contain the session

## 6. Access control

- [ ] A stranger with no session gets nothing on every trip route
- [ ] A member of trip A cannot open trip B
- [ ] "Not a member" and "no such trip" produce the **same** message
- [ ] An invalid invite token reveals nothing, and reads the same as a revoked one

## 7. Sync

- [ ] A edits the plan; B sees it within one poll interval with no manual reload
- [ ] B saves an idea; A sees it and the saver attribution
- [ ] A hidden tab stops polling

## 8. Concurrency

- [ ] Two writes against the same version: one accepted, one refused
- [ ] The accepted change survives
- [ ] The refusal explains without blaming the person

## 9. Input safety

Synthetic inputs into a name, an idea title and a note:

- [ ] `<script>alert(1)</script>` renders as text
- [ ] `javascript:alert(1)` in a link field is **rejected**, not stored
- [ ] A very long note does not break the layout
- [ ] Emoji and non-Latin text render correctly

## 10. CSRF

- [ ] No `GET` route mutates anything — including joining
- [ ] Mutations are POST server actions with an origin check
- [ ] `SameSite=Lax` is set

## 11. Failure behaviour

Each should be consumer-safe: no stack trace, no SQL, no connection string, no
key, and no false success.

- [ ] Invalid invite
- [ ] Expired invite
- [ ] Reused invite
- [ ] Revoked session
- [ ] Version conflict
- [ ] Shared mode unavailable

## 12. Client bundle audit

Search the deployed JavaScript for:

- [ ] `DASHSCOPE_API_KEY` — absent
- [ ] `DATABASE_URL` — absent
- [ ] `postgres://` / `postgresql://` — absent
- [ ] `PGSSLROOTCERT` / certificate content — absent
- [ ] `hashInviteToken` — absent
- [ ] Any session token or invite hash — absent

## 13. Model Studio

**One** call, not a research run.

- [ ] Server-only; nothing in the browser
- [ ] Correct Singapore workspace endpoint
- [ ] Truth label correct on screen
- [ ] Honest fallback when it fails

## 14. Local regression

With no cloud configuration at all:

- [ ] A local trip can be created and used end to end
- [ ] Explore, Plan, Group, Inbox, What-if, Money, Activity all work
- [ ] The Tokyo example is unchanged and deterministic
- [ ] Sharing controls say sharing is not configured, and create nothing

## 15. Cleanup

- [ ] Every synthetic trip removed by id prefix
- [ ] Orphan sessions removed
- [ ] `schema_migration` untouched
- [ ] Final counts recorded

## 16. Shared magic loop — run record

Run against **the deployed product**, `https://orkestr-travel.vercel.app`, two
isolated Chrome profiles, 390px. `scratchpad/sharedloop.mjs`, **22/22**.

- [x] The trip becomes shared (two deliberate clicks: preview, then share)
- [x] An invite link is created, and no token is ever rendered to the page
- [x] Zen joins in her own browser and is shown as herself
- [x] Luc's place, saved from a link, is on the shared trip
- [x] Zen sees it
- [x] Zen's second link for the same place makes **one** card
- [x] Both savers are named — *"Luc and Zen saved this"*
- [x] Both sources are kept — *"2 sources"*
- [x] The shared plan offers a first draft, and produces one
- [x] The draft persists, as one version bump
- [x] Zen sees the same plan
- [x] Ask answers the organiser from shared state
- [x] Ask answers a traveller too
- [x] A generated item can be pinned as fixed
- [x] Repair shows both halves of the impact
- [x] Repair says how many agreed things survive
- [x] The pinned item is in the untouched half
- [x] Zen can read her own private note
- [x] The group is told a requirement exists, not what it says
- [x] Six of Luc's pages never contain Zen's words
- [x] Ask never repeats Zen's words to Luc

`scratchpad/stale.mjs`, **5/5** — with Luc's tab backgrounded so `useTripSync`
stops polling, Zen changes the trip and Luc applies the draft he was looking at:

- [x] Refused in words: *"The trip changed while you were editing…"*
- [x] `plan=0` in the database — nothing was applied

`scratchpad/qa.mjs`, **390px and 430px**, six shared surfaces: no page scrolls
sideways, nothing overflows outside a container that scrolls on purpose.

**Interrupted once:** Vercel's Attack Challenge Mode blocked the deployment
partway through this stage, triggered by these runs. It was not evaded; the
acceptance ran against a local production build on the same database until the
mitigation cleared, then in full against the deployment (`SECURITY.md`).

### Cleanup performed

Thirteen synthetic trips removed by explicit id. `shared_trip` = 1 (the founder's,
untouched), `member_private_data` = 0, `trip_invitation` = 0, `schema_migration`
intact. Browser sessions deliberately untouched — see `IMPLEMENTATION_STATUS.md`.
