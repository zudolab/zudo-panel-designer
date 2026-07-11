// Tool registry. A tool file calls registerTool() at module load; the shell
// discovers them via import.meta.glob (see registry/index.ts) so adding a tool
// never touches a shared array or switch.
import type { ToolModule } from '../types';

const tools = new Map<string, ToolModule>();
const order: string[] = []; // preserve first-registered order for the toolbar

export function registerTool(tool: ToolModule): void {
  if (!tools.has(tool.id)) order.push(tool.id);
  tools.set(tool.id, tool);
}

export function unregisterTool(id: string): void {
  tools.delete(id);
  const i = order.indexOf(id);
  if (i >= 0) order.splice(i, 1);
}

export function getTool(id: string): ToolModule | undefined {
  return tools.get(id);
}

export function allTools(): ToolModule[] {
  return order.map((id) => tools.get(id)).filter((t): t is ToolModule => t !== undefined);
}

// Resolve a keyboard shortcut (case-insensitive) to a tool id, if any.
export function toolByShortcut(key: string): ToolModule | undefined {
  const lower = key.toLowerCase();
  return allTools().find((t) => t.shortcut?.toLowerCase() === lower);
}
