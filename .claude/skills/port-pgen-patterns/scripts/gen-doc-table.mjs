#!/usr/bin/env node
// Generates the MDX pattern/param reference table from the LIVE registry, so
// doc/src/content/docs/patterns/built-in-patterns.mdx (and its docs-ja
// mirror) never hand-drifts from packages/patterns/src/patterns/index.ts as
// port rounds add generators. Re-run after every port batch and paste the
// output into both language pages.
//
// The registry is recovered WITHOUT executing TS, the same way
// check-ledger.mjs does (plain node can't resolve the package's
// extensionless imports): patterns/index.ts is a hand-listed array of
// identifiers and shard spreads, so a static parse over that convention is
// exact. If the registry format ever drifts from the convention this script
// fails loudly rather than guessing. See check-ledger.mjs for the sibling
// check that cross-validates the same registry against the port ledger.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const PATTERNS_DIR = path.join(REPO_ROOT, 'packages', 'patterns', 'src', 'patterns');
const INDEX_PATH = path.join(PATTERNS_DIR, 'index.ts');

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
  const m = stripComments(src).match(new RegExp(`${constName}[^=]*=\\s*\\[([\\s\\S]*?)\\]\\s*;`));
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

// Every built-in writes each paramDef object on a single line, e.g.
// `{ key: 'pitch', label: 'Pitch (mm)', min: 2, max: 15, step: 0.5, defaultValue: 5 }`
// — a convention, not something the type system enforces. A per-object regex
// over the paramDefs array's raw text is exact for that convention and avoids
// pulling in a general JS object-literal parser for this one generator.
const PARAM_DEF_RE =
  /\{\s*key:\s*'([^']*)'\s*,\s*label:\s*'([^']*)'\s*,\s*min:\s*(-?[\d.]+)\s*,\s*max:\s*(-?[\d.]+)\s*,\s*step:\s*(-?[\d.]+)\s*,\s*defaultValue:\s*(-?[\d.]+)\s*,?\s*\}/g;

function parseParamDefs(moduleSrc, filePath) {
  const m = stripComments(moduleSrc).match(/paramDefs:\s*\[([\s\S]*?)\]\s*,\s*\n\s*draw/);
  if (!m) {
    throw new Error(`could not find a 'paramDefs: [...]' array before 'draw(' in ${filePath}`);
  }
  const defs = [];
  for (const match of m[1].matchAll(PARAM_DEF_RE)) {
    defs.push({
      key: match[1],
      label: match[2],
      min: Number(match[3]),
      max: Number(match[4]),
      step: Number(match[5]),
      defaultValue: Number(match[6]),
    });
  }
  if (defs.length === 0) {
    throw new Error(`'paramDefs: [...]' in ${filePath} parsed to zero param defs`);
  }
  return defs;
}

// Read a pattern module and pull its generator's name/displayName/paramDefs.
function readGenerator(moduleSpecifier, fromDir) {
  const filePath = path.join(fromDir, `${moduleSpecifier}.ts`);
  if (!existsSync(filePath)) {
    throw new Error(`imported module not found: ${filePath}`);
  }
  const src = readFileSync(filePath, 'utf8');
  const nameMatch = src.match(/name:\s*'([^']+)'/);
  const displayNameMatch = src.match(/displayName:\s*'([^']+)'/);
  if (!nameMatch) throw new Error(`no name: '...' literal found in ${filePath}`);
  if (!displayNameMatch) throw new Error(`no displayName: '...' literal found in ${filePath}`);
  return {
    name: nameMatch[1],
    displayName: displayNameMatch[1],
    paramDefs: parseParamDefs(src, filePath),
  };
}

// The 12 hand-listed top-level generators are grouped as 'original'; a shard
// spread is grouped by its identifier with the 'group' prefix stripped and
// the first letter lowercased (groupRingsCircuits -> ringsCircuits) — this
// matches pgen-port-ledger.json's section keys exactly, so the table's Group
// column lines up with the ledger.
function shardGroupName(ident) {
  const stripped = ident.replace(/^group/, '');
  return stripped.charAt(0).toLowerCase() + stripped.slice(1);
}

function collectRegistry() {
  const indexSrc = readFileSync(INDEX_PATH, 'utf8');
  const indexImports = importMap(indexSrc);
  const rows = [];
  for (const { ident, spread } of arrayEntries(indexSrc, 'PATTERN_GENERATORS', INDEX_PATH)) {
    const specifier = indexImports.get(ident);
    if (!specifier) throw new Error(`registry entry '${ident}' has no import in ${INDEX_PATH}`);
    if (!spread) {
      rows.push({ group: 'original', ...readGenerator(specifier, PATTERNS_DIR) });
      continue;
    }
    // shard: an exported PanelPatternGenerator[] of imported identifiers
    const shardPath = path.join(PATTERNS_DIR, `${specifier}.ts`);
    const shardSrc = readFileSync(shardPath, 'utf8');
    const shardImports = importMap(shardSrc);
    const group = shardGroupName(ident);
    for (const entry of arrayEntries(shardSrc, ident, shardPath)) {
      if (entry.spread) throw new Error(`nested spread in shard ${shardPath} is not supported`);
      const entrySpecifier = shardImports.get(entry.ident);
      if (!entrySpecifier) {
        throw new Error(`shard entry '${entry.ident}' has no import in ${shardPath}`);
      }
      rows.push({ group, ...readGenerator(entrySpecifier, PATTERNS_DIR) });
    }
  }
  return rows;
}

function formatParams(defs) {
  return defs
    .map(
      (d) =>
        `\`${d.key}\` — ${d.label}, ${d.min}–${d.max}, step ${d.step}, default ${d.defaultValue}`,
    )
    .join('; ');
}

function main() {
  let rows;
  try {
    rows = collectRegistry();
  } catch (err) {
    console.error(`gen-doc-table: registry parse failed — ${err.message}`);
    process.exit(1);
  }
  const lines = [];
  lines.push('| Pattern (`name`) | Group | Parameters (`key` — label, min–max, step, default) |');
  lines.push('|---|---|---|');
  for (const row of rows) {
    lines.push(
      `| ${row.displayName} (\`${row.name}\`) | ${row.group} | ${formatParams(row.paramDefs)} |`,
    );
  }
  process.stdout.write(lines.join('\n') + '\n');
  console.error(`gen-doc-table: ${rows.length} patterns`);
}

main();
