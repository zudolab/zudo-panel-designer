/**
 * Path Finder — selection → ordered inputs, and where the result lands.
 *
 * ── THE BACK→FRONT ORDERING CONTRACT (load-bearing) ─────────────────────────
 * `resolvePathfinderInputs` returns eligible leaves in PHYSICAL BOTTOM→TOP
 * order: index 0 is the BACKMOST, the last element is the FRONTMOST. Every op
 * reads z-role off that index — Minus Front keeps `[0]`, Minus Back keeps the
 * last, Trim/Crop/Divide attribute each face to the topmost filled cover, and
 * every style-inheritance rule names one end of the array.
 *
 * If this order is ever reversed or scrambled, ALL of those silently produce
 * the wrong answer: no exception, no empty result, just a plausible-looking
 * shape built from the wrong operand. That is why the order is derived here
 * from the same projection the renderer paints from — the fixed containers in
 * persisted physical order (copper → solder-mask → silkscreen), each walked in
 * tree DFS order — and pinned by an explicit test rather than assumed.
 */

import {
  projectPcbLayerSlices,
  type Layer,
  type PcbLayerRole,
  type PcbLayerStack,
} from '@zpd/core';
import { expandSelectionToLeafIds } from '../selection-resolve';
import type { EligibleLeaf, PathfinderTarget } from './types';

/**
 * Only `path` and `shape` leaves have a fill region the boolean kernel can
 * consume. Text is not outlined (a separate concern), an image is design-time
 * raster, and a pattern is a generator with no persisted outline.
 */
function isEligibleLayer(layer: Layer): layer is EligibleLeaf['layer'] {
  return layer.type === 'path' || layer.type === 'shape';
}

/**
 * The eligible leaves of a selection, back→front.
 *
 * Selection ids may be leaf OR group ids at any depth and may span material
 * containers; group ids expand to every descendant leaf. Hidden leaves are
 * excluded — the flat projection has already folded ancestor/container hidden
 * state down onto each leaf, so one check covers all three.
 *
 * There is deliberately NO same-parent requirement: inputs may live in
 * different groups at different depths, exactly as in Illustrator.
 *
 * Reads through `projectPcbLayerSlices`, which shares
 * `projectPcbLayerStack`'s WeakMap cache with `projectFlatLayers` — so this
 * returns the SAME leaf instances the renderer holds and does not mint a new
 * flat array (text geometry treats that array's identity as document
 * incarnation state; see flat-projection.ts).
 */
export function resolvePathfinderInputs(
  stack: PcbLayerStack,
  selectedIds: readonly string[],
): EligibleLeaf[] {
  if (selectedIds.length === 0) return [];
  const covered = new Set(expandSelectionToLeafIds(stack, selectedIds));
  if (covered.size === 0) return [];

  const slices = projectPcbLayerSlices(stack);
  const byRole: [PcbLayerRole, Layer[]][] = [
    ['copper', slices.copper],
    ['solder-mask', slices.solderMask],
    ['silkscreen', slices.silkscreen],
  ];

  const inputs: EligibleLeaf[] = [];
  for (const [role, layers] of byRole) {
    for (const layer of layers) {
      if (!covered.has(layer.id) || layer.hidden) continue;
      if (!isEligibleLayer(layer)) continue;
      inputs.push({ id: layer.id, layer, role });
    }
  }
  return inputs;
}

/**
 * Where a result lands for a selection spanning more than one material.
 *
 * RULE: the container of the FRONTMOST (topmost) eligible input, uniformly for
 * all ten ops. Its justification is the shape-mode style-inheritance rule —
 * Unite / Intersect / Exclude / Minus Back already adopt the topmost input's
 * paint, so geometry and material stay together and the committed layer needs
 * no colour rewrite.
 *
 * Two consequences worth stating, because neither is an error and both look
 * like one from the outside:
 *
 *  - MINUS FRONT inherits the BACKMOST input's style but still lands in the
 *    frontmost's container. On a cross-material selection `normalizeLayerMaterial`
 *    will then rewrite that inherited colour to the destination's. The uniform
 *    rule is kept anyway: a per-op destination would have to be re-derived from
 *    each op's style source, and the faces ops below have no single such source
 *    to derive it from.
 *  - The FACES OPS (divide / trim / merge / crop) attribute each face to a
 *    different input, so a cross-material result carries several colours into
 *    one container and all of them are normalized to it. This layer reports the
 *    attributed colour faithfully; collapsing it is the document mutation's
 *    doing, not a lost attribution here.
 *
 * Returns null only for an empty input list.
 */
export function pathfinderTarget(orderedInputs: readonly EligibleLeaf[]): PathfinderTarget | null {
  const frontmost = orderedInputs[orderedInputs.length - 1];
  return frontmost ? { role: frontmost.role, frontmostLeafId: frontmost.id } : null;
}
