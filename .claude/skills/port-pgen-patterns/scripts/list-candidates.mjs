#!/usr/bin/env node
// List pgen static patterns not yet accounted for in zpd's port ledger.
//
// Usage:
//   node list-candidates.mjs            human list grouped by family
//   node list-candidates.mjs --json     machine-readable JSON
//   node list-candidates.mjs <id...>    look up specific pgen ids (soft-verifies
//                                       each is kind 'static' and unledgered)
//
// pgen checkout resolution: $PGEN_DIR if set, else $HOME/repos/zp/pgen.

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const LEDGER_PATH = path.join(REPO_ROOT, 'packages/patterns/pgen-port-ledger.json');
const METADATA_REL = path.join('packages', 'generators', 'src', 'pattern-search-metadata.ts');

function fail(message) {
  console.error(`list-candidates: ${message}`);
  process.exit(1);
}

function resolveMetadataPath() {
  const pgenDir = process.env.PGEN_DIR ?? path.join(homedir(), 'repos', 'zp', 'pgen');
  const metadataPath = path.join(pgenDir, METADATA_REL);
  if (!existsSync(metadataPath)) {
    fail(
      `pgen checkout not found — expected ${metadataPath}.\n` +
        `Clone zudolab/zudo-pattern-gen to $HOME/repos/zp/pgen, or point PGEN_DIR ` +
        `at an existing checkout (PGEN_DIR=/path/to/pgen node list-candidates.mjs).`,
    );
  }
  return { pgenDir, metadataPath };
}

// The metadata module is generated data-only TS: one exported array literal of
// JSON objects. Slice from the '[' after the '=' to the last ']' and JSON.parse
// — no TS loader needed.
function readMetadata(metadataPath) {
  const src = readFileSync(metadataPath, 'utf8');
  const anchor = src.indexOf('PATTERN_SEARCH_METADATA');
  const start = src.indexOf('[', src.indexOf('=', anchor));
  const end = src.lastIndexOf(']');
  if (anchor === -1 || start === -1 || end <= start) {
    fail(`could not locate the PATTERN_SEARCH_METADATA array in ${metadataPath}`);
  }
  try {
    return JSON.parse(src.slice(start, end + 1));
  } catch (err) {
    fail(`could not parse ${metadataPath} as JSON data: ${err.message}`);
  }
}

function readLedgeredPgenIds() {
  if (!existsSync(LEDGER_PATH)) fail(`ledger not found at ${LEDGER_PATH}`);
  const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
  const ids = new Map(); // pgenId -> status
  for (const rows of Object.values(ledger)) {
    for (const row of rows) {
      if (row.pgenId != null) ids.set(row.pgenId, row.status);
    }
  }
  return ids;
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const queriedIds = args.filter((a) => a !== '--json');

const { pgenDir, metadataPath } = resolveMetadataPath();
const entries = readMetadata(metadataPath);
const ledgered = readLedgeredPgenIds();
const statics = entries.filter((e) => e.kind === 'static');

if (queriedIds.length > 0) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const id of queriedIds) {
    const entry = byId.get(id);
    const status = ledgered.get(id);
    if (!entry) {
      console.log(`${id}: NOT FOUND in pgen metadata (${metadataPath})`);
    } else if (entry.kind !== 'static') {
      console.log(`${id}: WARNING — kind '${entry.kind}', not portable (family: ${entry.family})`);
    } else if (status) {
      console.log(`${id}: already in ledger with status '${status}' (family: ${entry.family})`);
    } else {
      console.log(`${id}: static, unported — OK to port (family: ${entry.family})`);
    }
  }
  process.exit(0);
}

const candidates = statics.filter((e) => !ledgered.has(e.id));

if (asJson) {
  console.log(
    JSON.stringify(
      {
        pgenDir,
        totalStatic: statics.length,
        ledgered: ledgered.size,
        candidateCount: candidates.length,
        candidates: candidates.map(({ id, displayName, family }) => ({ id, displayName, family })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const byFamily = new Map();
for (const entry of candidates) {
  if (!byFamily.has(entry.family)) byFamily.set(entry.family, []);
  byFamily.get(entry.family).push(entry.id);
}

console.log(
  `${candidates.length} unported static pgen candidates ` +
    `(${statics.length} static in metadata − ${ledgered.size} already in ledger)\n`,
);
for (const [family, ids] of [...byFamily.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`${family} (${ids.length})`);
  console.log(`  ${ids.join(', ')}\n`);
}
