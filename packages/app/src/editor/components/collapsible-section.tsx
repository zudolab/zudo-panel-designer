// Reusable card-style collapsible panel used to build the sidebar's fixed
// section stack. Deliberately simple: no reordering, no persisted open state,
// no animation — just a toggle button and conditional rendering.
import { useId, useState, type ReactNode } from 'react';

export interface CollapsibleSectionProps {
  title: string | ReactNode;
  defaultOpen?: boolean;
  // Keep stateful children mounted while the section is closed. Hidden
  // content remains outside layout/the accessibility tree, but local UI state
  // (for example the Layers tree's session-only collapse sets) survives.
  keepMounted?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  defaultOpen = true,
  keepMounted = false,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section className="rounded-md border border-neutral-800 bg-neutral-900">
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((prev) => !prev)}
          className={`flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-300 ${
            open ? 'border-b border-neutral-800' : ''
          }`}
        >
          <span>{title}</span>
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>
      </h2>
      {(open || keepMounted) && (
        <div id={contentId} hidden={!open} className="px-3 py-2">
          {children}
        </div>
      )}
    </section>
  );
}
