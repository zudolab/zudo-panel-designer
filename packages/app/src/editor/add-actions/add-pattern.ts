// Adds a pattern layer. Wave 5 (#12) replaced the hardcoded dot-grid default
// with the picker dialog (dialogs/pattern-picker.tsx), which adds the layer
// itself once a pattern is chosen — same registered id/label, no other file
// changes.
import { registerAddAction } from '../registry/add-actions';

registerAddAction({
  id: 'add-pattern',
  label: 'Add pattern…',
  icon: '▦',
  run(ctx) {
    ctx.openDialog('pattern-picker');
  },
});
