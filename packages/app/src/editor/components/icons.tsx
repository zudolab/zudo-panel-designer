// Flat SVG icon set for the editor's shared chrome (toolbar, panels,
// dialogs). Ported from pgen's hand-authored composer icon set
// (zudolab/zudo-pattern-gen, packages/pattern-gen-viewer/src/components/
// composer/{composer-tool-palette,composer-palette-icons,
// composer-right-sidebar,layer-props/raster-effects-section}.tsx) — glyph
// JSX is copied verbatim rather than imported, so this module stays
// self-contained. `Ungroup` is adapted from Lucide's `ungroup` icon (ISC
// License, Copyright (c) Lucide Contributors) via pgen's
// packages/components/src/icons/library/lucide.ts.
//
// Contract (matches pgen's composer-palette-icons.tsx:13-23): single root
// `<svg viewBox="0 0 24 24">`, `stroke="currentColor"` strokeWidth 1.5-2,
// round caps/joins, `fill="none"`; intentionally-solid glyphs invert to
// `fill="currentColor" stroke="none"`. Each glyph below keeps its source
// strokeWidth. Every component accepts an optional `className` (sizing is
// left to the consumer, e.g. `h-4 w-4`) and renders `aria-hidden` on the svg.
import type { ReactNode } from 'react';

export interface IconProps {
  className?: string;
}

interface SvgProps extends IconProps {
  children: ReactNode;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

function Svg({
  className,
  children,
  fill = 'none',
  stroke = 'currentColor',
  strokeWidth = 2,
}: SvgProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

// Filled arrow cursor. Source explicitly asked to copy this verbatim —
// composer-tool-palette.tsx:27-33 (SelectIcon).
export function Select({ className }: IconProps) {
  return (
    <Svg className={className} fill="currentColor" stroke="none">
      <path d="M7 2l10 10-4 1 3 7-2 1-3-7-4 3V2z" />
    </Svg>
  );
}

// composer-tool-palette.tsx:46 (PanIcon).
export function Pan({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M18 11V6a2 2 0 00-4 0v5M14 10V4a2 2 0 00-4 0v6M10 9.5V6a2 2 0 00-4 0v8l-1.2-2.4a2 2 0 00-3.6 1.8L5 21h14l2-8a2 2 0 00-2-2h-3" />
    </Svg>
  );
}

// composer-tool-palette.tsx:54 (ZoomIcon).
export function Zoom({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16" y2="16" />
      <line x1="8" y1="11" x2="14" y2="11" />
      <line x1="11" y1="8" x2="11" y2="14" />
    </Svg>
  );
}

// composer-tool-palette.tsx:175 (PenIcon).
export function Pen({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </Svg>
  );
}

// composer-tool-palette.tsx:113 (AddTextIcon).
export function Text({ className }: IconProps) {
  return (
    <Svg className={className}>
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </Svg>
  );
}

// composer-tool-palette.tsx:79 (AddRectangleIcon).
export function Rect({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="6" width="18" height="12" rx="0" />
      <line x1="12" y1="2" x2="12" y2="4" strokeWidth={1.5} />
      <line x1="12" y1="20" x2="12" y2="22" strokeWidth={1.5} />
      <line x1="2" y1="12" x2="4" y2="12" strokeWidth={1.5} />
      <line x1="20" y1="12" x2="22" y2="12" strokeWidth={1.5} />
    </Svg>
  );
}

// composer-tool-palette.tsx:91 (AddEllipseIcon).
export function Ellipse({ className }: IconProps) {
  return (
    <Svg className={className}>
      <ellipse cx="12" cy="12" rx="9" ry="6" />
      <line x1="12" y1="2" x2="12" y2="4" strokeWidth={1.5} />
      <line x1="12" y1="20" x2="12" y2="22" strokeWidth={1.5} />
      <line x1="2" y1="12" x2="4" y2="12" strokeWidth={1.5} />
      <line x1="20" y1="12" x2="22" y2="12" strokeWidth={1.5} />
    </Svg>
  );
}

// composer-tool-palette.tsx:147 (AddPatternIcon).
export function Pattern({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </Svg>
  );
}

// composer-tool-palette.tsx:103 (AddImageIcon).
export function Image({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5-8 8" />
    </Svg>
  );
}

// composer-palette-icons.tsx:379 (iconUndo).
export function Undo({ className }: IconProps) {
  return (
    <Svg className={className} strokeWidth={1.6}>
      <path d="M9 6 L4 11 L9 16" />
      <path d="M4 11 H14 A6 6 0 0 1 14 23" transform="translate(0 -5)" />
    </Svg>
  );
}

// composer-palette-icons.tsx:386 (iconRedo).
export function Redo({ className }: IconProps) {
  return (
    <Svg className={className} strokeWidth={1.6}>
      <path d="M15 6 L20 11 L15 16" />
      <path d="M20 11 H10 A6 6 0 0 0 10 23" transform="translate(0 -5)" />
    </Svg>
  );
}

// composer-palette-icons.tsx:434 (iconUpload).
export function Upload({ className }: IconProps) {
  return (
    <Svg className={className} strokeWidth={1.6}>
      <path d="M12 16 V5" />
      <polyline points="7,9 12,4 17,9" />
      <path d="M4 19 H20" />
    </Svg>
  );
}

// composer-palette-icons.tsx:426 (iconDownload).
export function Download({ className }: IconProps) {
  return (
    <Svg className={className} strokeWidth={1.6}>
      <path d="M12 4 V15" />
      <polyline points="7,11 12,16 17,11" />
      <path d="M4 19 H20" />
    </Svg>
  );
}

// composer-palette-icons.tsx:505 (iconEye).
export function Eye({ className }: IconProps) {
  return (
    <Svg className={className} strokeWidth={1.6}>
      <path d="M2 12 C 5 6, 19 6, 22 12 C 19 18, 5 18, 2 12 Z" />
      <circle cx="12" cy="12" r="2.5" />
    </Svg>
  );
}

// composer-palette-icons.tsx:512 (iconEyeOff).
export function EyeOff({ className }: IconProps) {
  return (
    <Svg className={className} strokeWidth={1.6}>
      <path d="M3 3 L21 21" />
      <path d="M5 8 C 3.5 9.5, 2.5 11, 2 12 C 5 18, 19 18, 22 12 C 21.3 10.6, 20.3 9.1, 19 8" />
      <circle cx="12" cy="12" r="2.5" />
    </Svg>
  );
}

// composer-palette-icons.tsx:416 (iconTrash).
export function Trash({ className }: IconProps) {
  return (
    <Svg className={className} strokeWidth={1.6}>
      <path d="M5 7 H19" />
      <path d="M7 7 V20 A1 1 0 0 0 8 21 H16 A1 1 0 0 0 17 20 V7" />
      <path d="M9 7 V4 A1 1 0 0 1 10 3 H14 A1 1 0 0 1 15 4 V7" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </Svg>
  );
}

// composer-right-sidebar.tsx:803 (CloseIcon).
export function Close({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

// Derived from raster-effects-section.tsx:35 (ChevronUpIcon), scaled from
// its 0 0 12 12 viewBox to the module's 0 0 24 24 contract.
export function ChevronUp({ className }: IconProps) {
  return (
    <Svg className={className} strokeWidth={1.75}>
      <path d="M4 16 L12 8 L20 16" />
    </Svg>
  );
}

// Derived from raster-effects-section.tsx:52 (ChevronDownIcon), scaled from
// its 0 0 12 12 viewBox to the module's 0 0 24 24 contract.
export function ChevronDown({ className }: IconProps) {
  return (
    <Svg className={className} strokeWidth={1.75}>
      <path d="M4 8 L12 16 L20 8" />
    </Svg>
  );
}

// Right-pointing variant, rotated from ChevronDown to match the same
// contract (not present in pgen's UI set).
export function ChevronRight({ className }: IconProps) {
  return (
    <Svg className={className} strokeWidth={1.75}>
      <path d="M8 4 L16 12 L8 20" />
    </Svg>
  );
}

// composer-palette-icons.tsx:458 (iconFolderOpen).
export function Folder({ className }: IconProps) {
  return (
    <Svg className={className} strokeWidth={1.6}>
      <path d="M3 7 A1 1 0 0 1 4 6 H9 L11 8 H20 A1 1 0 0 1 21 9 V18 A1 1 0 0 1 20 19 H4 A1 1 0 0 1 3 18 Z" />
    </Svg>
  );
}

// Not present in pgen's UI set. Adapted from Lucide's `ungroup` icon (ISC
// License, Copyright (c) Lucide Contributors) via pgen's
// packages/components/src/icons/library/lucide.ts.
export function Ungroup({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="5" y="4" width="8" height="6" rx="1" />
      <rect x="11" y="14" width="8" height="6" rx="1" />
    </Svg>
  );
}

// composer-palette-icons.tsx:273 (iconPath, bezier with two handles).
export function Path({ className }: IconProps) {
  return (
    <Svg className={className} strokeWidth={1.6}>
      <path d="M5 19 C 5 11, 19 13, 19 5" />
      <circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="5" r="1.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}

// Filled star. composer-tool-palette.tsx:158 (AddIconIcon).
export function Star({ className }: IconProps) {
  return (
    <Svg className={className} fill="currentColor" stroke="none">
      <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
    </Svg>
  );
}

// Outline variant of Star — same path data, stroke instead of fill.
export function StarOutline({ className }: IconProps) {
  return (
    <Svg className={className} strokeWidth={1.4}>
      <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
    </Svg>
  );
}

// Gap glyph, not present in pgen's UI set: small open pentagon with a
// dashed closing segment and a solid anchor dot, for the pen tool's
// "Close path" action.
export function ClosePath({ className }: IconProps) {
  return (
    <Svg className={className} strokeWidth={1.6}>
      <path d="M12 4 L19.61 9.53 L16.7 18.47 L7.3 18.47 L4.39 9.53" />
      <path d="M4.39 9.53 L12 4" strokeDasharray="2 2" />
      <circle cx="12" cy="4" r="1.6" fill="currentColor" stroke="none" />
    </Svg>
  );
}

// Two overlapping rounded rectangles ("duplicate"/"copy"). Not present in
// pgen's UI set (pgen used a `⧉` glyph); authored to match this module's
// stroked contract for the layers panel's Duplicate action.
export function Copy({ className }: IconProps) {
  return (
    <Svg className={className} strokeWidth={1.6}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15 H4 A1 1 0 0 1 3 14 V4 A1 1 0 0 1 4 3 H14 A1 1 0 0 1 15 4 V5" />
    </Svg>
  );
}

// composer-palette-icons.tsx:253 (iconLayer, stacked layers).
export function Layer({ className }: IconProps) {
  return (
    <Svg className={className} strokeWidth={1.6}>
      <path d="M12 4 L21 9 L12 14 L3 9 Z" />
      <path d="M3 14 L12 19 L21 14" />
    </Svg>
  );
}
