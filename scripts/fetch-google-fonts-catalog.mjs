#!/usr/bin/env node

/**
 * Fetches Google Fonts metadata and generates a static JSON catalog.
 * Output: packages/app/src/editor/data/google-fonts-catalog.json
 *
 * Usage: node scripts/fetch-google-fonts-catalog.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../packages/app/src/editor/data/google-fonts-catalog.json');

const METADATA_URL = 'https://fonts.google.com/metadata/fonts';

/** Map Google's category strings (e.g. "Sans Serif") to our simplified categories */
function normalizeCategory(raw) {
  const map = {
    'sans-serif': 'sans-serif',
    serif: 'serif',
    display: 'display',
    handwriting: 'handwriting',
    monospace: 'monospace',
  };
  const key = raw?.toLowerCase().replace(/\s+/g, '-');
  return map[key] ?? 'sans-serif';
}

async function main() {
  console.log('Fetching Google Fonts metadata...');

  const res = await fetch(METADATA_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch metadata: ${res.status} ${res.statusText}`);
  }

  // The metadata endpoint returns JSON with a ")]}'" prefix for XSS protection
  let text = await res.text();
  if (text.startsWith(")]}'")) {
    text = text.slice(text.indexOf('\n') + 1);
  }

  const data = JSON.parse(text);
  const families = data.familyMetadataList;

  if (!Array.isArray(families)) {
    throw new Error('Unexpected metadata format: familyMetadataList not found');
  }

  console.log(`Found ${families.length} font families`);

  const catalog = families.map((entry) => {
    const variants = [];
    if (entry.fonts) {
      for (const key of Object.keys(entry.fonts)) {
        // key format: "400", "400i", "700", "700i", etc.
        const weight = key.replace('i', '');
        const isItalic = key.endsWith('i');
        if (weight === '400' && !isItalic) variants.push('regular');
        else if (weight === '400' && isItalic) variants.push('italic');
        else if (isItalic) variants.push(`${weight}italic`);
        else variants.push(weight);
      }
    }

    // "menu" is Google's own preview-text bucket and is present on every
    // single family in the response — it isn't a real language subset, so
    // it's dropped here to keep `subsets` meaningful for filtering (e.g.
    // subsets.includes('japanese')).
    const subsets = (entry.subsets ?? []).filter((subset) => subset !== 'menu');

    return {
      family: entry.family,
      category: normalizeCategory(entry.category),
      variants: variants.length > 0 ? variants : ['regular'],
      subsets,
    };
  });

  // Sort alphabetically
  catalog.sort((a, b) => a.family.localeCompare(b.family));

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(catalog, null, 2) + '\n');

  console.log(`Wrote ${catalog.length} entries to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
