#!/usr/bin/env node
// Cross-check pgen-port-ledger.json against the pattern registry:
//   - every registered generator has exactly one ledger row with status
//     'ported' or 'original'
//   - every 'ported'/'original' row has a matching registered generator
//   - zpdNames unique, pgenIds unique (nulls exempt), statuses valid
// Non-zero exit + a readable diff on any drift.
//
// The registry is recovered WITHOUT executing TS (plain node can't resolve the
// package's extensionless imports): patterns/index.ts is a hand-listed array of
// identifiers and shard spreads, so a static parse over that convention is
// exact. If the registry format ever drifts from the convention this script
// fails loudly rather than guessing.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const PATTERNS_DIR = path.join(REPO_ROOT, 'packages', 'patterns', 'src', 'patterns');
const INDEX_PATH = path.join(PATTERNS_DIR, 'index.ts');
const LEDGER_PATH = path.join(REPO_ROOT, 'packages', 'patterns', 'pgen-port-ledger.json');

const VALID_STATUSES = new Set(['ported', 'original', 'rejected']);
const ACTIVE_STATUSES = new Set(['ported', 'original']);

const problems = [];

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// identifier -> relative module specifier, from every value import in the file.
function importMap(src) {
  const map = new Map();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const rawName of m[1].split(',')) {
      const name = rawName.trim();
      if (!name || name.startsWith('type ')) continue;
      map.set(name, m[2]);
    }
  }
  return map;
}

// Entries of `<constName> ... = [ ... ];` as { ident, spread } tokens.
function arrayEntries(src, constName, filePath) {
  const m = stripComments(src).match(
    new RegExp(`${constName}[^=]*=\\s*\\[([\\s\\S]*?)\\]\\s*;`),
  );
  if (!m) {
    throw new Error(`could not find the ${constName} array literal in ${filePath}`);
  }
  return m[1]
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((token) => {
      const parsed = token.match(/^(\.\.\.)?([A-Za-z_$][\w$]*)$/);
      if (!parsed) {
        throw new Error(`unparseable entry '${token}' in ${constName} (${filePath})`);
      }
      return { ident: parsed[2], spread: Boolean(parsed[1]) };
    });
}

// Read a pattern module and pull its generator's `name: '...'` literal.
function generatorName(moduleSpecifier, fromDir) {
  const filePath = path.join(fromDir, `${moduleSpecifier}.ts`);
  if (!existsSync(filePath)) {
    throw new Error(`imported module not found: ${filePath}`);
  }
  const m = readFileSync(filePath, 'utf8').match(/name:\s*['"]([^'"]+)['"]/);
  if (!m) {
    throw new Error(`no name: '...' literal found in ${filePath}`);
  }
  return m[1];
}

function collectRegistryNames() {
  const indexSrc = readFileSync(INDEX_PATH, 'utf8');
  const indexImports = importMap(indexSrc);
  const names = [];
  for (const { ident, spread } of arrayEntries(indexSrc, 'PATTERN_GENERATORS', INDEX_PATH)) {
    const specifier = indexImports.get(ident);
    if (!specifier) throw new Error(`registry entry '${ident}' has no import in ${INDEX_PATH}`);
    if (!spread) {
      names.push(generatorName(specifier, PATTERNS_DIR));
      continue;
    }
    // shard: an exported PanelPatternGenerator[] of imported identifiers
    const shardPath = path.join(PATTERNS_DIR, `${specifier}.ts`);
    const shardSrc = readFileSync(shardPath, 'utf8');
    const shardImports = importMap(shardSrc);
    for (const entry of arrayEntries(shardSrc, ident, shardPath)) {
      if (entry.spread) throw new Error(`nested spread in shard ${shardPath} is not supported`);
      const entrySpecifier = shardImports.get(entry.ident);
      if (!entrySpecifier) {
        throw new Error(`shard entry '${entry.ident}' has no import in ${shardPath}`);
      }
      names.push(generatorName(entrySpecifier, PATTERNS_DIR));
    }
  }
  return names;
}

let registryNames;
try {
  registryNames = collectRegistryNames();
} catch (err) {
  console.error(`check-ledger: registry parse failed — ${err.message}`);
  process.exit(1);
}

if (!existsSync(LEDGER_PATH)) {
  console.error(`check-ledger: ledger not found at ${LEDGER_PATH}`);
  process.exit(1);
}
const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));

const seenZpdNames = new Map(); // zpdName -> section
const seenPgenIds = new Map(); // pgenId -> section
const activeNames = new Set();
let rowCount = 0;

for (const [section, rows] of Object.entries(ledger)) {
  if (!Array.isArray(rows)) {
    problems.push(`section '${section}' is not an array`);
    continue;
  }
  rows.forEach((row, i) => {
    rowCount += 1;
    const where = `${section}[${i}]`;
    if (typeof row.zpdName !== 'string' || row.zpdName.length === 0) {
      problems.push(`${where}: missing zpdName`);
      return;
    }
    if (!VALID_STATUSES.has(row.status)) {
      problems.push(`${where} (${row.zpdName}): invalid status '${row.status}'`);
    }
    if (typeof row.date !== 'string' || typeof row.notes !== 'string') {
      problems.push(`${where} (${row.zpdName}): date and notes must be strings`);
    }
    if (row.pgenId !== null && typeof row.pgenId !== 'string') {
      problems.push(`${where} (${row.zpdName}): pgenId must be a string or null`);
    }
    if (seenZpdNames.has(row.zpdName)) {
      problems.push(
        `duplicate zpdName '${row.zpdName}' (${seenZpdNames.get(row.zpdName)} and ${where})`,
      );
    }
    seenZpdNames.set(row.zpdName, where);
    if (typeof row.pgenId === 'string') {
      if (seenPgenIds.has(row.pgenId)) {
        problems.push(
          `duplicate pgenId '${row.pgenId}' (${seenPgenIds.get(row.pgenId)} and ${where})`,
        );
      }
      seenPgenIds.set(row.pgenId, where);
    }
    if (ACTIVE_STATUSES.has(row.status)) activeNames.add(row.zpdName);
  });
}

const registrySet = new Set(registryNames);
const dupRegistry = registryNames.filter((n, i) => registryNames.indexOf(n) !== i);
for (const name of dupRegistry) problems.push(`duplicate generator name in registry: '${name}'`);

const missingFromLedger = registryNames.filter((n) => !activeNames.has(n));
const missingFromRegistry = [...activeNames].filter((n) => !registrySet.has(n));
if (missingFromLedger.length > 0) {
  problems.push(
    `registered but no ported/original ledger row: ${missingFromLedger.join(', ')}`,
  );
}
if (missingFromRegistry.length > 0) {
  problems.push(
    `ledgered as ported/original but not registered: ${missingFromRegistry.join(', ')}`,
  );
}

if (problems.length > 0) {
  console.error(`check-ledger: FAIL — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `check-ledger: OK — ${registryNames.length} registered generators ↔ ` +
    `${activeNames.size} active ledger rows (${rowCount} rows total across ` +
    `${Object.keys(ledger).length} sections)`,
);
