// Left vertical toolbar: tool buttons (from the tool registry) + add-actions
// (from the add-action registry). Both lists are data-driven — a new tool or
// add-action file appears here automatically, no edit to this component.
import { allAddActions } from '../registry/add-actions';
import { allTools } from '../registry/tools';
import type { ToolContext } from '../types';
import { ChromeButton } from './chrome';

export interface ToolbarProps {
  ctx: ToolContext;
  activeToolId: string;
}

export function Toolbar({ ctx, activeToolId }: ToolbarProps) {
  return (
    <nav className="flex w-12 flex-col items-center gap-1.5 border-r border-neutral-800 bg-neutral-900 py-2">
      {allTools().map((tool) => (
        <ChromeButton
          key={tool.id}
          active={tool.id === activeToolId}
          tooltip={tool.shortcut ? `${tool.label} (${tool.shortcut.toUpperCase()})` : tool.label}
          onClick={() => ctx.setActiveTool(tool.id)}
          className="h-8 w-8 !px-0 text-base"
        >
          {tool.icon ?? tool.label.slice(0, 1)}
        </ChromeButton>
      ))}

      <span className="my-1 h-px w-6 bg-neutral-700" />

      {allAddActions().map((action) => (
        <ChromeButton
          key={action.id}
          tooltip={action.label}
          onClick={() => action.run(ctx)}
          className="h-8 w-8 !px-0 text-base"
        >
          {action.icon ?? '+'}
        </ChromeButton>
      ))}
    </nav>
  );
}
