// Document space is millimeters, origin at panel top-left.
// PCB fabrication data is mm-based, so mm is the single storage space;
// px exists only at the render boundary (mm -> screen px via the camera).

export type ColorIndex = 0 | 1 | 2; // 0=black(soldermask) 1=gold(copper/ENIG) 2=white(silkscreen)

export interface LayerBase {
  id: string;
  name: string;
  hidden?: boolean;
}

export interface ShapeLayer extends LayerBase {
  type: 'shape';
  shape: 'rect' | 'ellipse';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number; // deg clockwise around bbox center
  color: ColorIndex;
}

// A positioned SQUARE object, no longer an implicit whole-panel fill (#96):
// the pattern draws inside (x,y)-(x+size,y+size) in document mm. The default
// placement covers the panel — see patternCoverGeometry (pattern-geometry.ts).
// A panel HP change deliberately keeps x/y/size (the square may stop covering;
// the inspector's "Cover panel" reset is the recovery).
export interface PatternLayer extends LayerBase {
  type: 'pattern';
  // Kept as opaque data even when unrecognized — the patterns registry is an
  // app-level concern, not a core dependency (see @zpd/patterns).
  patternType: string;
  params: Record<string, number>;
  color: ColorIndex;
  x: number;
  y: number;
  size: number; // square side, mm
}

export interface PathPoint {
  x: number; // anchor, mm
  y: number;
  hin?: { x: number; y: number }; // absolute bezier handle coords, mm
  hout?: { x: number; y: number };
}

export interface PathLayer extends LayerBase {
  type: 'path';
  points: PathPoint[]; // primary subpath (pen tool edits this one)
  // additional closed subpaths from image tracing (holes/islands of one
  // color region); rendered together with evenodd fill so holes stay holes
  extraSubpaths?: PathPoint[][];
  closed: boolean;
  fill: ColorIndex | null;
  stroke: ColorIndex | null;
  strokeWidth: number; // mm
}

export interface TextLayer extends LayerBase {
  type: 'text';
  content: string; // may contain newlines
  fontFamily: string;
  sizeMm: number; // font size in mm (canvas font px == mm in doc space)
  x: number; // bbox top-left, mm
  y: number;
  rotation?: number;
  color: ColorIndex;
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  // Design-time source only — a raster cannot be manufactured on the panel.
  // The final panel uses the vector layers traced from it.
  src: string; // dataURL
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Layer = ShapeLayer | PatternLayer | PathLayer | TextLayer | ImageLayer;

export type GuideOrientation = 'horizontal' | 'vertical';

// A ruler guide: an infinite straight line in document space.
// - 'horizontal' is a horizontal line at y = position (spans the panel width)
// - 'vertical'   is a vertical line at x = position (spans the panel height)
// position is mm in document space. Hidden guides render faintly (ruler UI, #54)
// and never participate in snapping (#55).
export interface Guide {
  id: string;
  orientation: GuideOrientation;
  position: number; // mm
  hidden?: boolean;
}

export interface DocState {
  panelHp: number;
  layers: Layer[]; // bottom -> top (index 0 renders first)
  // Required (never optional): read sites stay clean (no `doc.guides ?? []`),
  // and the serialization boundary owns backward-compat (old configs -> []).
  guides: Guide[];
}

let idCounter = 0;
export function mintId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}
