// Reusable card-style collapsible panel used to build the sidebar's fixed
// section stack. Deliberately simple: no reordering, no persisted open state,
// no animation — just a toggle button and conditional rendering.
import { useId, useState, type ReactNode } from 'react';

export interface CollapsibleSectionProps {
  title: string | ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({ title, defaultOpen = true, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section className="rounded-md border border-neutral-800 bg-neutral-900">
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
      {open && (
        <div id={contentId} className="px-3 py-2">
          {children}
        </div>
      )}
    </section>
  );
}
