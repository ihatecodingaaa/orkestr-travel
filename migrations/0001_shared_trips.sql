-- Shared trips: the tables a group needs to open one trip from several devices.
--
-- STANDARD POSTGRESQL. No provider extension, no vendor type, no hosted-service
-- SDK. A managed Postgres from any provider runs this unchanged, which is what
-- keeps the hosting decision reversible.
--
-- THE SHAPE ENFORCES THE PRIVACY RULE. Owner-only values live in
-- member_private_data, which no group query touches. The group-visible trip is
-- one JSONB payload in shared_trip, and it does not contain them -- not
-- filtered out on read, not present. A future query written by somebody who has
-- never read the privacy docs still cannot leak a budget, because the table it
-- selects from does not have one.

BEGIN;

CREATE TABLE IF NOT EXISTS shared_trip (
  id           TEXT        PRIMARY KEY,
  -- Bumped on every accepted write. Optimistic concurrency lives here.
  version      INTEGER     NOT NULL DEFAULT 1,
  -- Group-visible ConsumerTrip. Contains no owner-only values.
  payload      JSONB       NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL,
  CONSTRAINT shared_trip_version_positive CHECK (version > 0)
);

CREATE TABLE IF NOT EXISTS trip_member (
  id            TEXT        PRIMARY KEY,
  trip_id       TEXT        NOT NULL REFERENCES shared_trip(id) ON DELETE CASCADE,
  -- The id this person has inside the trip payload, so membership and the
  -- planning model line up without either knowing the other's storage.
  traveller_id  TEXT        NOT NULL,
  name          TEXT        NOT NULL,
  role          TEXT        NOT NULL CHECK (role IN ('ORGANISER', 'TRAVELLER')),
  joined_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL,
  UNIQUE (trip_id, traveller_id)
);

CREATE INDEX IF NOT EXISTS trip_member_trip_idx ON trip_member (trip_id);

-- Owner-only. Read exclusively by the member it belongs to.
CREATE TABLE IF NOT EXISTS member_private_data (
  trip_id      TEXT        NOT NULL REFERENCES shared_trip(id) ON DELETE CASCADE,
  member_id    TEXT        NOT NULL REFERENCES trip_member(id) ON DELETE CASCADE,
  requirements JSONB       NOT NULL DEFAULT '[]'::jsonb,
  updated_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (trip_id, member_id)
);

-- Only the HASH of an invite token is stored. A dump of this table yields
-- SHA-256 of 256-bit random values and no usable links.
CREATE TABLE IF NOT EXISTS trip_invitation (
  id           TEXT        PRIMARY KEY,
  trip_id      TEXT        NOT NULL REFERENCES shared_trip(id) ON DELETE CASCADE,
  member_id    TEXT        NOT NULL REFERENCES trip_member(id) ON DELETE CASCADE,
  token_hash   TEXT        NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  redeemed_at  TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_by   TEXT
);

CREATE INDEX IF NOT EXISTS trip_invitation_trip_idx ON trip_invitation (trip_id);

-- A browser, not a person. Stage 3 has no global account by design.
CREATE TABLE IF NOT EXISTS browser_session (
  id           TEXT        PRIMARY KEY,
  token_hash   TEXT        NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);

-- One browser may hold memberships in several trips: organiser of Seoul,
-- traveller on Bali. A future account binds to these rows rather than
-- replacing the trip data.
CREATE TABLE IF NOT EXISTS session_membership (
  session_id TEXT        NOT NULL REFERENCES browser_session(id) ON DELETE CASCADE,
  trip_id    TEXT        NOT NULL REFERENCES shared_trip(id) ON DELETE CASCADE,
  member_id  TEXT        NOT NULL REFERENCES trip_member(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (session_id, trip_id)
);

CREATE INDEX IF NOT EXISTS session_membership_session_idx ON session_membership (session_id);

-- What happened, in words a traveller would use. NEVER a private value.
CREATE TABLE IF NOT EXISTS trip_event (
  id        TEXT        PRIMARY KEY,
  trip_id   TEXT        NOT NULL REFERENCES shared_trip(id) ON DELETE CASCADE,
  at        TIMESTAMPTZ NOT NULL,
  summary   TEXT        NOT NULL,
  member_id TEXT,
  detail    TEXT
);

CREATE INDEX IF NOT EXISTS trip_event_trip_at_idx ON trip_event (trip_id, at DESC);

COMMIT;
