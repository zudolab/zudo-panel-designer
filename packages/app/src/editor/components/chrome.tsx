// Shared dark-chrome button used across the header/toolbar. Outside the
// globbed extension folders on purpose.
import type { ButtonHTMLAttributes } from 'react';

export function ChromeButton({
  active = false,
  className = '',
  tooltip,
  title,
  'aria-label': ariaLabel,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; tooltip?: string }) {
  const button = (
    <button
      type="button"
      {...props}
      title={tooltip ? undefined : title}
      aria-label={tooltip ?? ariaLabel}
      className={`rounded border px-2 py-1 text-xs transition-colors disabled:cursor-default disabled:opacity-40 ${
        active
          ? 'border-sky-500 bg-sky-500/20 text-sky-200'
          : 'border-neutral-700 bg-neutral-800 text-neutral-200 hover:bg-neutral-700'
      } ${tooltip ? 'peer' : ''} ${className}`}
    />
  );

  if (!tooltip) return button;

  return (
    // `peer` + `peer-focus-visible` (not group-focus-within) so a mouse
    // click that leaves the button focused doesn't leave the tooltip stuck
    // open — :focus-visible only fires for keyboard-style focus.
    <span className="relative inline-block">
      {button}
      <span
        role="tooltip"
        aria-hidden="true"
        className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 opacity-0 shadow transition-opacity delay-300 peer-hover:opacity-100 peer-focus-visible:opacity-100"
      >
        {tooltip}
      </span>
    </span>
  );
}
