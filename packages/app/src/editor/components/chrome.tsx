// Shared dark-chrome button used across the header/toolbar. Outside the
// globbed extension folders on purpose.
import type { ButtonHTMLAttributes } from 'react';
import { Tooltip } from './tooltip';

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
    <Tooltip content={tooltip} placement="right">
      {button}
    </Tooltip>
  );
}
