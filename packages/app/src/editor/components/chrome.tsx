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
      } ${className}`}
    />
  );

  if (!tooltip) return button;

  return (
    // group-focus-visible doesn't fire when the child button (not the
    // wrapper) receives focus — group-focus-within is the workaround.
    <span className="group/tt relative inline-block">
      {button}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 opacity-0 shadow transition-opacity delay-300 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100"
      >
        {tooltip}
      </span>
    </span>
  );
}
