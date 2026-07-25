---
name: l-lessons-doc-site-authoring
description: Project lessons learned for authoring the doc/ site (zudo-doc / zfb / MDX, EN + docs-ja). Read PROACTIVELY before planning or implementing work touching doc/src/content/ — contains traps, root causes, and "watch for next time" notes from previous attempts, including which verification command is actually a gate.
---

# Lessons — doc site authoring (`doc/`)

Scope: `doc/` — the zudo-doc (zfb-based) documentation site, MDX content under
`doc/src/content/docs/` (EN) and `doc/src/content/docs-ja/` (JA).

## 2026-07-26 — Documenting the Gerber export across both locales

### What we set out to do

Document an already-shipped feature (the Gerber export button, its confirm gate, and its
refusal dialog) on the UI-surface doc pages, in English and Japanese.

### Approach we tried first

Split the work by locale into parallel authoring tasks, and gave each author
`pnpm check` as its verification gate — deferring `pnpm build` to a later
"central" wave to avoid two agents running a heavy build concurrently.

### Why it went wrong (root cause)

**`pnpm check` and `pnpm build` exercise different pipelines.** `check` runs `tsc --noEmit`
over collections; it never renders MDX. Only `build` compiles MDX to HTML. So the
acceptance criteria handed to the authors could pass green on a page that could not
render at all. A bare `{hp}` in prose compiled as a JSX expression and the build died
with `ReferenceError: hp is not defined` — after the work had already been merged to the
base, because every assigned check had passed.

The CPU-contention reasoning for deferring the build was sound; the mistake was letting
the cheap check *stand in for* the real gate in the authors' criteria rather than
labelling it as a partial check.

### What worked instead

- `cd doc && pnpm build` as the gate, with `broken link:` grepped **explicitly** from its
  output — the build exits 0 even when it emits broken-link warnings, so exit code alone
  proves nothing. (Tracked upstream: Takazudo/zudo-front-builder#2046 asks zfb to expose a
  strict mode; drop the grep once that lands.)
- A brace scanner (strip fenced blocks and inline code spans, then flag any remaining
  `{ident}`) run over the changed `.mdx` files before committing.
- Verifying anchors against **built HTML**, not source markdown.

### Watch for next time

- **If your verification is `pnpm check` and you touched `.mdx`, you have not verified
  anything about rendering.** `check` cannot fail on a page that throws at render time.
  The gate is `cd doc && pnpm build`, plus an explicit `grep -i "broken link"` of its
  output.
- **If you write `{anything}` in MDX prose, the build will try to evaluate it as a JSX
  expression.** Every placeholder must sit inside a backtick code span. This is the single
  highest-severity authoring trap in this directory.
- **If you verified an anchor by confirming the heading exists, you have not verified the
  anchor.** zudo-doc generates **hierarchical** slugs: an `###` under `## Download trigger`
  is `#download-trigger-gerber-export`, not `#gerber-export`. Pre-existing examples:
  `#built-in-tools-select-v-pattern-squares`, `#レイヤーのフィールド-path-pathpoint`.
  Read the truth out of the built page's ToC payload:
  `grep -oE '"depth":[23],"slug":"[^"]*"' dist/**/index.html`.
- **The two locales do not behave identically for anchors.** EN emits
  `broken link: #gerber-export` for a leaf-slug link; JA silently resolved the equivalent
  leaf form with no warning. **A green JA build is not proof an anchor is right** — check
  the emitted `href=#…` in the built HTML. Do not generalize an anchor conclusion from one
  locale to the other.
- **`doc/` is NOT a pnpm workspace member.** `pnpm-workspace.yaml` lists only `packages/*`;
  `doc/` is a standalone project with its own lockfile and `node_modules`. `pnpm --filter
  doc <script>` does not resolve — it exits "No projects matched the filters". Run doc
  commands from the `doc/` directory, matching CI (`working-directory: doc`). A worktree
  needs its own `cd doc && pnpm install --frozen-lockfile` before any doc command works.
- **Blockquote dialog mockups collapse soft line breaks into one paragraph.** That is fine
  for the established one-message-plus-button-row shape (`autosave.mdx`,
  `round-trip.mdx`'s "Replace current panel?"), but it silently destroys any mockup with
  multiple distinct lines — two refusal reasons merged into indistinguishable run-on prose.
  For multi-line dialog content, keep the blockquote for title + button row and lift the
  body into a real markdown list below it. **Do not reach for `<br>` or trailing-double-space
  hard breaks** — neither is used anywhere in `src/content/`, so both are untested here.
- **Nested lists inside blockquotes mis-render.** Un-indented lines after a `> - item`
  become lazy continuations of that list item and get swallowed.
- **`doc` is in `.prettierignore`** (line 7), so hand-authored list/blockquote indentation
  survives — but it also means no formatter will catch malformed markdown for you.

### Cross-locale parity — the criterion needs a method, not a judgment

A confirm pass chartered to verify "any fact present in one locale and absent in the other
is a defect" reported clean after checking that facts did not **contradict**. A later
reviewer enumerating both pages found **19 facts present in exactly one locale**. Same
words, much weaker reading.

- **If a parity check returns "no contradictions found," it did not do a parity check.**
  Parity requires enumerating the fact set of each locale and diffing them, not reading for
  conflicts.
- Divergence runs in **both** directions and is not obvious from a diff: EN carried the
  UI-surface detail (verbatim mockups, a scannable table); JA carried the mechanism and
  reasoning (why the module split exists, why the export cannot round-trip). Each locale
  looks complete on its own.
- `docs-ja/` is **not** table-averse or English-averse: it already has 12 markdown tables
  and already quotes untranslated English dialog copy in blockquotes
  (`docs-ja/editor/autosave.mdx`, `docs-ja/export/round-trip.mdx`). Omitting those devices
  from JA is a deviation from JA's own conventions, not a locale-appropriate choice.
- JA pages use **Japanese anchors** (`#ダウンロードトリガー`, `#インポート`). Never rename an
  existing JA heading — other `docs-ja` pages link to them.

### Would-skip-if-redoing

- **Assigning `pnpm check` as an author-facing acceptance criterion.** It gave false
  confidence and let a build-breaking page merge. Either give authors the build, or state
  plainly in the criteria that the check is partial and rendering is unverified until the
  central pass.
- **Deriving anchors from convention.** Two rounds were spent on an anchor question that
  one `grep` of the built ToC payload settled immediately — and an intermediate conclusion
  generalized from EN to JA was simply wrong.
- **Trusting a green build as proof of link correctness.** Broken links are warnings; the
  build still exits 0 and still prints `✓ NN pages built`.
- **`Closes #A, #B, #C` in a PR body.** GitHub only auto-closed the first issue. Repeat the
  keyword per issue (`Closes #A. Closes #B. Closes #C.`) or close the rest manually.
