// Sidebar footer content (#36): explains the currently ACTIVE tool (not the
// transient Space-held pan override — see Editor.tsx's activeToolId vs
// effectiveToolId split). Lives inside a CollapsibleSection pinned below the
// scrollable panel stack in sidebar.tsx.
import { getTool } from '../registry/tools';

export interface HelpPanelProps {
  activeToolId: string;
}

const FALLBACK_DESCRIPTION = 'No description available for this tool yet.';

export function HelpPanel({ activeToolId }: HelpPanelProps) {
  const tool = getTool(activeToolId);
  const label = tool?.label ?? activeToolId;
  const shortcut = tool?.shortcut;
  const description = tool?.description ?? FALLBACK_DESCRIPTION;

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-neutral-200">{label}</span>
        {shortcut && (
          <span className="rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-sky-300">
            {shortcut.toUpperCase()}
          </span>
        )}
      </div>
      <p className="text-neutral-400">{description}</p>
    </div>
  );
}
