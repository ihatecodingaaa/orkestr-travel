# Starting a fresh Claude session

Paste the block below into a new session. It is deliberately short:
`SESSION_TRANSFER.md` is the source of truth, and this only points at it.

---

```
CRITICAL REPOSITORY IDENTITY CHECK

Before doing anything:

  pwd
  git rev-parse --show-toplevel
  git remote -v
  git branch --show-current
  git log -5 --oneline
  git status

The ONLY authorised repository is:
  C:\Users\lucas\Documents\orkestr-travel

Remote must be:
  https://github.com/ihatecodingaaa/orkestr-travel.git

If the git root is orkestr_luc, STOP IMMEDIATELY. That is the preserved
startup repository and it is out of scope: do not inspect, edit, install,
test or commit anything in it.

THEN, BEFORE PROPOSING ANY WORK:

1. Read docs/SESSION_TRANSFER.md in full. It is the accurate account of
   what exists, what works, and what is only written down.
2. Read docs/IMPLEMENTATION_STATUS.md. It outranks every other document
   on the question of what actually works.
3. Run: npm run verify
   Expect a green gate. If it is not green, STOP and report it rather
   than repairing unexplained damage.
4. Run: npm run preflight:model-studio
   This makes no network request and prints no secret. It tells you
   whether external calls are possible right now.

WHAT YOU MUST NOT ASSUME

- Do not assume Alibaba Cloud, Model Studio or Atlas is configured
  because adapter code exists for them. As of the last session, none of
  them had ever been contacted. The preflight command tells you the
  truth in one second.
- Do not mark anything IMPLEMENTED or LIVE VERIFIED that you have not
  actually run. If one operation succeeds and another fails, record
  exactly that split.
- Do not guess Atlas endpoints, request shapes or capabilities.
- Do not create .env.local or invent a credential.
- Do not rewrite the deterministic engines to use a model. Feasibility
  being arithmetic is the point of the project.

WHERE TO CONTINUE

The next unfinished work is LIVE MODEL STUDIO VERIFICATION, which is
blocked until the founder creates .env.local with a real credential and
sets MODEL_STUDIO_MODE=live. docs/EXTERNAL_SETUP.md is the runbook.

If that credential now exists, work through section J of
SESSION_TRANSFER.md in order.

If it does not exist yet, say so plainly and do not attempt live calls.

STOP BEFORE ATLAS (Phase 7) unless explicitly authorised.
```

---

## Why this file is separate from `SESSION_TRANSFER.md`

Two different jobs.

`SESSION_TRANSFER.md` is the detailed record: identity, thesis, phase history,
invariants, known gaps. It is long because the project is, and a new session
reading it should end up genuinely informed rather than confidently wrong.

This file is the startup prompt. It is short on purpose. Its only job is to make
a fresh session check the ground before it walks on it, and then send it to read
the real document.

Keeping them apart means the prompt stays pasteable and the record stays
complete, without either being compromised by the other's constraints.
