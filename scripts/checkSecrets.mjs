#!/usr/bin/env node
/**
 * Secret-safety gate.
 *
 *   npm run check:secrets      (also runs inside npm run verify)
 *
 * A deliberately SMALL, project-specific check. It is not a general secret
 * scanner: those are either noisy enough that people learn to ignore them, or
 * quiet enough to miss the one thing that matters. This looks for the handful of
 * mistakes that would actually hurt THIS repository, each of which has a known
 * shape.
 *
 * It runs over TRACKED FILES ONLY, via `git ls-files`. That is the correct
 * scope: the danger is a secret reaching the remote, and an ignored file cannot.
 * It also means the check never reads `.env.local`, which is the point -- a
 * safety tool that opens the secret file to see whether it is safe has become
 * the leak it was guarding against.
 *
 * Exit 1 on any finding, so `npm run verify` fails before a push can happen.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const findings = [];

function report(file, rule, detail) {
  findings.push({ file, rule, detail });
}

/** Files git is tracking. Untracked and ignored files are out of scope. */
function trackedFiles() {
  const out = execFileSync("git", ["ls-files"], { encoding: "utf8" });
  return out.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}

const files = trackedFiles();

/* ------------------------------------------------------------------ rule 1 */
/**
 * An environment file must never be tracked.
 *
 * `.env.example` is the one permitted exception, and only because it contains
 * names and empty values.
 */
for (const file of files) {
  const base = file.split("/").pop() ?? file;
  if (base === ".env.example") continue;
  if (base === ".env" || base.startsWith(".env.")) {
    report(file, "tracked-env-file", "An environment file is tracked by git.");
  }
}

/* ------------------------------------------------------------------ rule 2 */
/**
 * `.gitignore` must still exclude the local environment files.
 *
 * Checked directly rather than assumed: this is one deleted line away from
 * being untrue, and nothing else in the build would notice.
 */
if (existsSync(".gitignore")) {
  const ignore = readFileSync(".gitignore", "utf8");
  for (const required of [".env", ".env.local", ".env.*.local"]) {
    if (!ignore.split("\n").some((l) => l.trim() === required)) {
      report(".gitignore", "missing-ignore", `".gitignore" no longer excludes ${required}`);
    }
  }
} else {
  report(".gitignore", "missing-ignore", "There is no .gitignore.");
}

/* --------------------------------------------------------------- rules 3-6 */

/** A DashScope key. The real shape is `sk-` plus a long hex-ish run. */
const KEY_SHAPED = /\bsk-[A-Za-z0-9]{24,}\b/;

/**
 * Words that prove a key-shaped literal is deliberately fake.
 *
 * The repository convention this enforces: ANY key-shaped string committed here
 * must contain one of these, so that "is this real?" is answerable by reading
 * the string rather than by trusting whoever wrote it.
 *
 * An earlier version allowlisted prefixes such as `sk-abc` and matched them
 * anywhere in the token. That was worse than useless: a genuine key beginning
 * `sk-abc` would have been waved through by the very check meant to catch it.
 * A required marker fails closed instead -- a real key contains none of these
 * words, so a real key is always reported.
 */
const FAKE_MARKERS = [
  "test",
  "not-real",
  "notreal",
  "example",
  "placeholder",
  "your-",
  "never",
  "fake",
  "dummy",
  "redact",
  "super-secret",
];

const isPlaceholder = (token) => {
  const lower = token.toLowerCase();
  return FAKE_MARKERS.some((marker) => lower.includes(marker));
};

const TEXT_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".md", ".css", ".yml", ".yaml", ".example",
];

for (const file of files) {
  if (!TEXT_EXTENSIONS.some((ext) => file.endsWith(ext)) && !file.startsWith(".env")) continue;
  if (file === "package-lock.json") continue;

  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue; // Binary or unreadable. Nothing to scan.
  }

  // rule 3: a real-looking credential committed anywhere.
  for (const line of source.split("\n")) {
    const match = KEY_SHAPED.exec(line);
    if (match !== null && !isPlaceholder(match[0])) {
      report(file, "key-shaped-literal", "A string shaped like a real DashScope key.");
      break;
    }
  }

  // rule 4: a secret behind the public prefix, which publishes it to every
  // visitor at build time and makes rotation the only remedy.
  if (/NEXT_PUBLIC_[A-Z0-9_]*(KEY|SECRET|TOKEN|DASHSCOPE|WORKSPACE|CREDENTIAL|PASSWORD)/.test(source)) {
    report(file, "public-prefixed-secret", "A secret-looking name carries the NEXT_PUBLIC_ prefix.");
  }

  // rule 5: a hard-coded Authorization header. The only legitimate one is built
  // from configuration at the transport boundary.
  const authLiteral = /Authorization["'\s:]+["'`]\s*Bearer\s+[A-Za-z0-9._-]{12,}/i;
  if (authLiteral.test(source)) {
    report(file, "hard-coded-authorization", "A literal Authorization: Bearer value.");
  }

  // rule 6: a populated credential assignment in a tracked env file.
  if (file.endsWith(".env.example") || file.startsWith(".env")) {
    for (const line of source.split("\n")) {
      const assignment = /^\s*(DASHSCOPE_API_KEY|MODEL_STUDIO_WORKSPACE_ID|ATLAS_API_KEY)\s*=\s*(.+)$/.exec(line);
      if (assignment !== null && assignment[2] !== undefined && assignment[2].trim().length > 0) {
        report(file, "populated-credential", `${assignment[1]} has a value in a tracked file.`);
      }
    }
  }
}

/* ------------------------------------------------------------------ rule 7 */
/**
 * The credential must stay readable from exactly one module.
 *
 * Not a secret-detection rule but a blast-radius one: every additional file that
 * reads the key is another place it can be logged, serialised or returned.
 */
const keyReaders = files.filter((file) => {
  if (!file.endsWith(".ts") && !file.endsWith(".tsx")) return false;
  if (file.startsWith("tests/") || file.startsWith("evals/") || file.startsWith("scripts/")) return false;
  try {
    return readFileSync(file, "utf8").includes("DASHSCOPE_API_KEY");
  } catch {
    return false;
  }
});
if (keyReaders.length > 1) {
  report(
    keyReaders.join(", "),
    "credential-read-in-many-places",
    `${keyReaders.length} modules name DASHSCOPE_API_KEY; exactly one should.`,
  );
}

/* ---------------------------------------------------------------- reporting */

const out = [];
if (findings.length === 0) {
  out.push(
    "",
    `  Secret safety: OK  (${files.length} tracked files scanned)`,
    "    - no environment file tracked",
    "    - .gitignore still excludes .env, .env.local, .env.*.local",
    "    - no key-shaped literal, no NEXT_PUBLIC_ secret, no hard-coded Authorization",
    "    - credential named in exactly one module",
    "",
  );
  process.stdout.write(out.join("\n"));
  process.exit(0);
}

out.push("", `  Secret safety: ${findings.length} FINDING(S)`, "");
for (const finding of findings) {
  out.push(`  [${finding.rule}] ${finding.file}`, `      ${finding.detail}`, "");
}
out.push(
  "  Nothing has been printed from the offending line, deliberately.",
  "  Open the file yourself.",
  "",
);
process.stderr.write(out.join("\n"));
process.exit(1);
