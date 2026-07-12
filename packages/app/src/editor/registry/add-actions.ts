// Add-action registry — the "add rect / add ellipse / add pattern… / add
// image…" buttons on the toolbar. Each action file registers one entry.
import type { AddAction } from '../types';

const addActions = new Map<string, AddAction>();
const order: string[] = [];

export function registerAddAction(action: AddAction): void {
  if (!addActions.has(action.id)) order.push(action.id);
  addActions.set(action.id, action);
}

export function unregisterAddAction(id: string): void {
  addActions.delete(id);
  const i = order.indexOf(id);
  if (i >= 0) order.splice(i, 1);
}

export function allAddActions(): AddAction[] {
  return order.map((id) => addActions.get(id)).filter((a): a is AddAction => a !== undefined);
}
