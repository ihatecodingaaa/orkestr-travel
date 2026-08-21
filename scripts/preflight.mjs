#!/usr/bin/env node
/**
 * Model Studio pre-flight.
 *
 *   npm run preflight:model-studio
 *
 * Answers one question, offline: **would a live call work if we tried one?**
 *
 * IT MAKES NO NETWORK REQUEST. Not a HEAD, not a DNS lookup, nothing. Its whole
 * value is that it can be run on a laptop with no credentials, on a plane, or by
 * somebody who has just cloned the repository and wants to know what state it is
 * in before touching anything that costs money.
 *
 * IT PRINTS NO SECRET. Not the key, not its length, not its prefix, not the
 * workspace id, not a constructed URL containing one. "sk-abc..." is still four
 * characters of a secret, and a key length is useful to somebody guessing one.
 * Every line below is either a fixed string or a yes/no.
 *
 * WHY IT IS PLAIN JAVASCRIPT rather than another vitest harness: this is the one
 * command somebody runs when they are not sure the project works. It should
 * depend on as little as possible, start instantly, and never be confused with
 * the test suite. It reads `.env.local` itself, the same way the eval harness
 * does, because Next's environment loading is not available outside Next.
 *
 * EXIT CODE IS DELIBERATELY 0 WHEN NOT CONFIGURED. Absence of credentials is the
 * expected state of a fresh checkout, not a broken repository, and a non-zero
 * exit would make it look like something is wrong when nothing is.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** Load `.env.local` without overwriting anything already in the environment. */
function loadLocalEnv() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) return false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;
    const key = trimmed.slice(0, equals).trim();
    if (key.length === 0 || process.env[key] !== undefined) continue;
    let value = trimmed.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
  return true;
}

/** Present and non-empty. The ONLY question ever asked about a secret. */
function isSet(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

const yn = (value) => (value ? "YES" : "NO");

const KNOWN_REGIONS = [
  "ap-southeast-1",
  "ap-northeast-1",
  "cn-beijing",
  "cn-hongkong",
  "eu-central-1",
];
const KNOWN_MODES = ["disabled", "recorded", "live"];

const hadEnvFile = loadLocalEnv();

const rawMode = (process.env["MODEL_STUDIO_MODE"] ?? "").trim().toLowerCase();
const mode = KNOWN_MODES.includes(rawMode) ? rawMode : "disabled";
const modeWasUnrecognised = rawMode.length > 0 && !KNOWN_MODES.includes(rawMode);

const region = (process.env["MODEL_STUDIO_REGION"] ?? "ap-southeast-1").trim();
const regionKnown = KNOWN_REGIONS.includes(region);

const hasKey = isSet("DASHSCOPE_API_KEY");
const hasWorkspace = isSet("MODEL_STUDIO_WORKSPACE_ID");
const hasExplicitBaseUrl = isSet("DASHSCOPE_BASE_URL");

// The endpoint is constructible from a workspace + known region, or from an
// explicit override. Whether it is constructible is printable; the URL is not,
// because it embeds the workspace id.
const endpointConstructible = hasExplicitBaseUrl || (hasWorkspace && regionKnown);

const extractionModel = (process.env["QWEN_EXTRACTION_MODEL"] ?? "qwen3.7-plus").trim();
const researchModel = (process.env["QWEN_RESEARCH_MODEL"] ?? "qwen3.7-plus").trim();

const liveEnabled = mode === "live";
const readyForLive = liveEnabled && hasKey && endpointConstructible;

const lines = [
  "",
  "  Orkestr Travel - Model Studio pre-flight",
  "  (offline: this command makes no network request)",
  "",
  `  .env.local present:            ${yn(hadEnvFile)}`,
  `  Model Studio mode:             ${mode}${modeWasUnrecognised ? "  (unrecognised value; defaulted closed)" : ""}`,
  `  Live calls enabled:            ${yn(liveEnabled)}`,
  "",
  `  Region:                        ${region}${regionKnown ? "" : "  (not a region this build knows)"}`,
  `  Workspace ID configured:       ${yn(hasWorkspace)}`,
  `  Explicit base URL configured:  ${yn(hasExplicitBaseUrl)}`,
  `  Endpoint constructible:        ${yn(endpointConstructible)}`,
  `  API key configured:            ${yn(hasKey)}`,
  "",
  `  Extraction model:              ${extractionModel}`,
  `  Research model:                ${researchModel}`,
  "",
  `  Ready for live verification:   ${yn(readyForLive)}`,
  "",
];

// Say what to do next, specifically. A status report that leaves somebody
// guessing which of five variables is the problem has done half a job.
if (!readyForLive) {
  const todo = [];
  if (!hasKey) todo.push("set DASHSCOPE_API_KEY in .env.local");
  if (!endpointConstructible) {
    todo.push(
      hasWorkspace
        ? `set MODEL_STUDIO_REGION to one of: ${KNOWN_REGIONS.join(", ")}`
        : "set MODEL_STUDIO_WORKSPACE_ID in .env.local (or DASHSCOPE_BASE_URL)",
    );
  }
  if (!liveEnabled) todo.push("set MODEL_STUDIO_MODE=live to permit external calls");

  lines.push("  To reach live verification:");
  for (const item of todo) lines.push(`    - ${item}`);
  lines.push(
    "",
    "  This is NOT an error. The application, the demo, the test suite and the",
    "  production build all work in this state, using fixture data that is",
    "  labelled as fixture data. See docs/EXTERNAL_SETUP.md.",
    "",
  );
} else {
  lines.push(
    "  Next: npm run smoke:model-studio   (one tiny fictional request)",
    "        npm run eval:qwen            (17 fictional evaluation cases)",
    "",
    "  Both cost money. Neither runs as part of npm run verify.",
    "",
  );
}

process.stdout.write(lines.join("\n"));

// Always 0. "Not configured" is a state, not a failure.
process.exit(0);
