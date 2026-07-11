// Adds a pattern layer. Wave 3 drops in a default (dot-grid) directly; Wave 5
// (#12) replaces this handler's body with a picker dialog (openDialog) while
// keeping the same registered id/label — no other file changes.
import { mintId, type PatternLayer } from '@zpd/core';
import { defaultParams, patternByName } from '@zpd/patterns';
import { registerAddAction } from '../registry/add-actions';

const DEFAULT_PATTERN = 'dot-grid';

registerAddAction({
  id: 'add-pattern',
  label: 'Add pattern…',
  icon: '▦',
  run(ctx) {
    const gen = patternByName(DEFAULT_PATTERN);
    const layer: PatternLayer = {
      id: mintId('pattern'),
      name: gen?.displayName ?? 'Pattern',
      type: 'pattern',
      patternType: DEFAULT_PATTERN,
      color: 1,
      params: defaultParams(DEFAULT_PATTERN),
    };
    ctx.commit({ ...ctx.doc, layers: [...ctx.doc.layers, layer] });
    ctx.select(layer.id);
  },
});
