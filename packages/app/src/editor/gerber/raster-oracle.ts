/**
 * A software Canvas2D and scanline rasteriser, for the differential parity
 * harness only (#211's acceptance). Imported by tests; nothing in the app
 * imports it.
 *
 * ── Why this exists rather than a real canvas ──────────────────────────────
 * The acceptance bar is "render the real generator to a canvas, render the
 * recorded vector IR to a canvas, compare" across EVERY generator. Node has no
 * Canvas2D, and the browser-tooling route is out of scope for this work, so the
 * oracle is written here — which turns out to be the stronger option anyway,
 * because it can be made deliberately INDEPENDENT of the code under test:
 *
 *  - it carries its own path model (plain polylines, spec-read separately from
 *    `canvas-path.ts`) rather than reusing the recorder's;
 *  - it flattens arcs and cubics by uniform sampling, not by the production
 *    adaptive flattener, so an arc-approximation bug cannot cancel itself out;
 *  - it strokes by Canvas's OWN definition — the union of one quadrilateral per
 *    segment, one join shape per interior vertex and one cap shape per end —
 *    which is a completely different construction from `stroker.ts`'s traced
 *    outline. (That decomposition is unusable for the vector pipeline because
 *    path-bool mis-resolves its corner-exact tangencies, but a rasteriser just
 *    ORs the pieces together and never has to adjudicate anything.)
 *
 * What the two sides do share is the rasteriser itself, which is fair: it is
 * the "canvas" both are rendered to, not part of either implementation.
 *
 * Coordinates are document millimetres, y-down, exactly like everything else.
 */

import type { IrRegion } from './ir';

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export type FillRule = 'nonzero' | 'evenodd';

const TAU = Math.PI * 2;
const WELD = 1e-9;

// ─── the raster ────────────────────────────────────────────────────────────

export class Mask {
  readonly bits: Uint8Array;
  /** Millimetres per pixel. */
  readonly step: number;

  constructor(
    readonly originX: number,
    readonly originY: number,
    readonly sizeMm: number,
    readonly n: number,
  ) {
    this.bits = new Uint8Array(n * n);
    this.step = sizeMm / n;
  }

  get(i: number, j: number): number {
    return this.bits[j * this.n + i];
  }

  get filled(): number {
    let count = 0;
    for (const b of this.bits) count += b;
    return count;
  }
}

interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  minY: number;
  maxY: number;
}

function buildEdges(polys: readonly (readonly Pt[])[]): Edge[] {
  const edges: Edge[] = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (a.y === b.y) continue; // horizontal edges never cross a scanline
      edges.push({
        x0: a.x,
        y0: a.y,
        x1: b.x,
        y1: b.y,
        minY: Math.min(a.y, b.y),
        maxY: Math.max(a.y, b.y),
      });
    }
  }
  edges.sort((a, b) => a.minY - b.minY);
  return edges;
}

/**
 * OR the polygons' interior (under `rule`) into the mask, sampling at pixel
 * centres with an active-edge sweep.
 *
 * Sampling at centres rather than computing exact coverage is deliberate: an
 * antialiased comparison would need a matching antialiased reference on the
 * other side, and the geometric question here — "is this shape the same shape"
 * — is answered by a hard mask plus the boundary-band tolerance in
 * {@link compareMasks}.
 */
export function fillPolygons(mask: Mask, polys: readonly (readonly Pt[])[], rule: FillRule): void {
  const edges = buildEdges(polys);
  if (edges.length === 0) return;

  const { originX, originY, step, n, bits } = mask;
  let lowY = Infinity;
  let highY = -Infinity;
  for (const e of edges) {
    if (e.minY < lowY) lowY = e.minY;
    if (e.maxY > highY) highY = e.maxY;
  }
  const firstRow = Math.max(0, Math.ceil((lowY - originY) / step - 0.5));
  const lastRow = Math.min(n - 1, Math.floor((highY - originY) / step - 0.5));
  if (lastRow < firstRow) return;

  let next = 0;
  // Admit every edge whose span can still reach the first sampled row.
  const firstY = originY + (firstRow + 0.5) * step;
  const active: Edge[] = [];
  while (next < edges.length && edges[next].minY <= firstY) active.push(edges[next++]);

  const xs: number[] = [];
  const winds: number[] = [];
  for (let j = firstRow; j <= lastRow; j++) {
    const y = originY + (j + 0.5) * step;
    while (next < edges.length && edges[next].minY <= y) active.push(edges[next++]);
    let write = 0;
    for (let k = 0; k < active.length; k++) {
      if (active[k].maxY <= y) continue;
      active[write++] = active[k];
    }
    active.length = write;
    if (active.length === 0) continue;

    xs.length = 0;
    winds.length = 0;
    for (const e of active) {
      // Half-open crossing test: an edge counts when the scanline is at or
      // above its lower endpoint and strictly below its upper one, so a shared
      // vertex is counted exactly once.
      if (!(e.minY <= y && y < e.maxY)) continue;
      xs.push(e.x0 + ((y - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0));
      winds.push(e.y1 > e.y0 ? 1 : -1);
    }
    if (xs.length < 2) continue;

    const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
    let winding = 0;
    for (let k = 0; k < order.length - 1; k++) {
      winding += winds[order[k]];
      const inside = rule === 'nonzero' ? winding !== 0 : k % 2 === 0;
      if (!inside) continue;
      const spanStart = xs[order[k]];
      const spanEnd = xs[order[k + 1]];
      const i0 = Math.max(0, Math.ceil((spanStart - originX) / step - 0.5));
      const i1 = Math.min(n - 1, Math.ceil((spanEnd - originX) / step - 0.5) - 1);
      const row = j * n;
      for (let i = i0; i <= i1; i++) bits[row + i] = 1;
    }
  }
}

/** Rasterise the vector result: outer rings positive, holes negative, nonzero. */
export function fillRegions(mask: Mask, regions: readonly IrRegion[]): void {
  const polys: Pt[][] = [];
  for (const region of regions) {
    polys.push(region.outer.map((p) => ({ x: p.x, y: p.y })));
    for (const hole of region.holes) polys.push(hole.map((p) => ({ x: p.x, y: p.y })));
  }
  if (polys.length > 0) fillPolygons(mask, polys, 'nonzero');
}

// ─── flattening, independent of the production flattener ───────────────────

/** Uniform-angle arc sampling fine enough that its sagitta is well under a pixel. */
function sampleArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  sweep: number,
  toleranceMm: number,
  out: Pt[],
): void {
  if (!(r > 0) || sweep === 0) return;
  // sagitta = r(1 − cos(Δ/2)) ≤ tol  ⇒  Δ ≤ 2·acos(1 − tol/r)
  const maxStep = r > toleranceMm ? 2 * Math.acos(1 - toleranceMm / r) : TAU;
  const steps = Math.max(2, Math.min(20000, Math.ceil(Math.abs(sweep) / maxStep)));
  for (let i = 1; i <= steps; i++) {
    const a = startAngle + (sweep * i) / steps;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
}

function sampleCubic(p0: Pt, c1: Pt, c2: Pt, p3: Pt, toleranceMm: number, out: Pt[]): void {
  const hull =
    Math.hypot(c1.x - p0.x, c1.y - p0.y) +
    Math.hypot(c2.x - c1.x, c2.y - c1.y) +
    Math.hypot(p3.x - c2.x, p3.y - c2.y);
  const steps = Math.max(
    4,
    Math.min(4000, Math.ceil(Math.sqrt(hull / Math.max(toleranceMm, 1e-9)))),
  );
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
    });
  }
}

// ─── stroke pieces, by Canvas's own definition ─────────────────────────────

function dedupe(points: readonly Pt[], closed: boolean): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < WELD) continue;
    out.push(p);
  }
  while (closed && out.length >= 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(last.x - first.x, last.y - first.y) >= WELD) break;
    out.pop();
  }
  return out;
}

function disc(center: Pt, r: number): Pt[] {
  const steps = 128;
  const poly: Pt[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (TAU * i) / steps;
    poly.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) });
  }
  return poly;
}

export interface OracleStrokeStyle {
  readonly lineWidth: number;
  readonly lineCap: 'butt' | 'round' | 'square';
  readonly lineJoin: 'miter' | 'round' | 'bevel';
  readonly miterLimit: number;
}

/**
 * The convex pieces whose union IS the stroke, straight out of the HTML spec's
 * description: a quadrilateral per segment, a join shape per interior vertex, a
 * cap shape per open end, and a dot/square for a zero-length subpath.
 */
export function strokePieces(
  points: readonly Pt[],
  closed: boolean,
  style: OracleStrokeStyle,
): Pt[][] {
  const h = style.lineWidth / 2;
  if (!(h > 0) || !Number.isFinite(h)) return [];
  const p = dedupe(points, closed);
  if (p.length === 0) return [];

  if (p.length === 1) {
    if (style.lineCap === 'round') return [disc(p[0], h)];
    if (style.lineCap === 'square') {
      return [
        [
          { x: p[0].x - h, y: p[0].y - h },
          { x: p[0].x + h, y: p[0].y - h },
          { x: p[0].x + h, y: p[0].y + h },
          { x: p[0].x - h, y: p[0].y + h },
        ],
      ];
    }
    return [];
  }

  const n = p.length;
  const loop = closed && n >= 3;
  const segCount = loop ? n : n - 1;
  const dirs: Pt[] = [];
  const nrms: Pt[] = [];
  for (let i = 0; i < segCount; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    dirs.push(d);
    nrms.push({ x: -d.y, y: d.x });
  }

  const pieces: Pt[][] = [];
  for (let i = 0; i < segCount; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    const nx = nrms[i].x * h;
    const ny = nrms[i].y * h;
    pieces.push([
      { x: a.x + nx, y: a.y + ny },
      { x: b.x + nx, y: b.y + ny },
      { x: b.x - nx, y: b.y - ny },
      { x: a.x - nx, y: a.y - ny },
    ]);
  }

  const firstJoint = loop ? 0 : 1;
  const lastJoint = loop ? n - 1 : n - 2;
  for (let i = firstJoint; i <= lastJoint; i++) {
    const d0 = dirs[(i - 1 + segCount) % segCount];
    const d1 = dirs[i % segCount];
    const cross = d0.x * d1.y - d0.y * d1.x;
    const dot = d0.x * d1.x + d0.y * d1.y;
    const v = p[i];
    if (style.lineJoin === 'round') {
      pieces.push(disc(v, h));
      continue;
    }
    if (Math.abs(cross) < 1e-12 && dot > 0) continue; // collinear: nothing to fill
    // With nrm = (−dy, dx) in y-down space, the OUTER side of the turn is the
    // one opposite the sign of the cross product.
    const s = cross > 0 ? -1 : 1;
    const n0 = { x: -d0.y * s * h, y: d0.x * s * h };
    const n1 = { x: -d1.y * s * h, y: d1.x * s * h };
    const o0 = { x: v.x + n0.x, y: v.y + n0.y };
    const o1 = { x: v.x + n1.x, y: v.y + n1.y };
    if (style.lineJoin === 'miter') {
      const turn = Math.atan2(cross, dot);
      const cosHalf = Math.cos(Math.abs(turn) / 2);
      // miterLength / lineWidth = 1 / sin(interiorAngle/2) = 1 / cos(turn/2).
      if (cosHalf > 0 && 1 / cosHalf <= style.miterLimit) {
        const ux = n0.x + n1.x;
        const uy = n0.y + n1.y;
        const ulen = Math.hypot(ux, uy);
        if (ulen > 1e-12) {
          const reach = h / cosHalf;
          pieces.push([v, o0, { x: v.x + (ux / ulen) * reach, y: v.y + (uy / ulen) * reach }, o1]);
          continue;
        }
      }
    }
    pieces.push([v, o0, o1]); // bevel, and the miter-limit fallback
  }

  if (!loop) {
    const ends: { at: Pt; nrm: Pt; outward: Pt }[] = [
      { at: p[0], nrm: nrms[0], outward: { x: -dirs[0].x, y: -dirs[0].y } },
      { at: p[n - 1], nrm: nrms[segCount - 1], outward: dirs[segCount - 1] },
    ];
    for (const end of ends) {
      if (style.lineCap === 'butt') continue;
      if (style.lineCap === 'round') {
        pieces.push(disc(end.at, h));
        continue;
      }
      const a = { x: end.at.x + end.nrm.x * h, y: end.at.y + end.nrm.y * h };
      const b = { x: end.at.x - end.nrm.x * h, y: end.at.y - end.nrm.y * h };
      pieces.push([
        a,
        { x: a.x + end.outward.x * h, y: a.y + end.outward.y * h },
        { x: b.x + end.outward.x * h, y: b.y + end.outward.y * h },
        b,
      ]);
    }
  }
  return pieces;
}

// ─── the reference context ─────────────────────────────────────────────────

interface OracleSubpath {
  points: Pt[];
  closed: boolean;
  start: Pt;
}

/**
 * A Canvas2D good enough for the 17 members the generators use, painting
 * straight into a {@link Mask}. Its path bookkeeping is written from the HTML
 * spec independently of `canvas-path.ts` — the two agreeing is evidence, the
 * two sharing code would not be. The mask covers exactly the pattern square, so
 * the square clip `renderer.ts:407-411` applies is reproduced by construction.
 */
export class ReferenceCanvas {
  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;
  lineCap: OracleStrokeStyle['lineCap'] = 'butt';
  lineJoin: OracleStrokeStyle['lineJoin'] = 'miter';
  miterLimit = 10;

  private subpaths: OracleSubpath[] = [];

  constructor(
    readonly mask: Mask,
    private readonly curveToleranceMm = mask.step / 8,
  ) {}

  private get last(): OracleSubpath | undefined {
    return this.subpaths[this.subpaths.length - 1];
  }

  private get current(): Pt | undefined {
    const sub = this.last;
    return sub ? sub.points[sub.points.length - 1] : undefined;
  }

  private open(p: Pt): OracleSubpath {
    const sub: OracleSubpath = { points: [p], closed: false, start: p };
    this.subpaths.push(sub);
    return sub;
  }

  beginPath(): void {
    this.subpaths = [];
  }

  moveTo(x: number, y: number): void {
    this.open({ x, y });
  }

  lineTo(x: number, y: number): void {
    const sub = this.last;
    if (!sub) {
      this.open({ x, y });
      return;
    }
    sub.points.push({ x, y });
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    const sub = this.last ?? this.open({ x: c1x, y: c1y });
    const p0 = sub.points[sub.points.length - 1];
    sampleCubic(
      p0,
      { x: c1x, y: c1y },
      { x: c2x, y: c2y },
      { x, y },
      this.curveToleranceMm,
      sub.points,
    );
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    const sub = this.last ?? this.open({ x: cpx, y: cpy });
    const p0 = sub.points[sub.points.length - 1];
    sampleCubic(
      p0,
      { x: p0.x + (2 / 3) * (cpx - p0.x), y: p0.y + (2 / 3) * (cpy - p0.y) },
      { x: x + (2 / 3) * (cpx - x), y: y + (2 / 3) * (cpy - y) },
      { x, y },
      this.curveToleranceMm,
      sub.points,
    );
  }

  arc(
    cx: number,
    cy: number,
    r: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    const delta = endAngle - startAngle;
    const wrapped = delta % TAU;
    // Clockwise takes the angle the short way round forwards, counter-clockwise
    // backwards; a full turn or more in the travelled direction is the whole
    // circle. Derived from the spec text, not from `canvas-path.ts`.
    const sweep = !counterclockwise
      ? delta >= TAU
        ? TAU
        : wrapped < 0
          ? wrapped + TAU
          : wrapped
      : -delta >= TAU
        ? -TAU
        : wrapped > 0
          ? wrapped - TAU
          : wrapped;
    const entry = { x: cx + r * Math.cos(startAngle), y: cy + r * Math.sin(startAngle) };
    const sub = this.last;
    if (!sub) {
      this.open(entry);
    } else {
      const cur = this.current!;
      if (Math.hypot(cur.x - entry.x, cur.y - entry.y) > 0) sub.points.push(entry);
    }
    sampleArc(cx, cy, r, startAngle, sweep, this.curveToleranceMm, this.last!.points);
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.subpaths.push({
      points: [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
      closed: true,
      start: { x, y },
    });
    this.open({ x, y });
  }

  closePath(): void {
    const sub = this.last;
    if (!sub) return;
    sub.closed = true;
    this.open(sub.start);
  }

  fill(rule: FillRule = 'nonzero'): void {
    const polys = this.subpaths.filter((s) => s.points.length >= 2).map((s) => s.points);
    if (polys.length > 0) fillPolygons(this.mask, polys, rule);
  }

  stroke(): void {
    const style: OracleStrokeStyle = {
      lineWidth: this.lineWidth,
      lineCap: this.lineCap,
      lineJoin: this.lineJoin,
      miterLimit: this.miterLimit,
    };
    for (const sub of this.subpaths) {
      if (sub.points.length < 2) continue;
      for (const piece of strokePieces(sub.points, sub.closed, style)) {
        fillPolygons(this.mask, [piece], 'nonzero');
      }
    }
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    if (w === 0 || h === 0) return;
    fillPolygons(
      this.mask,
      [
        [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ],
      ],
      'nonzero',
    );
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    const style: OracleStrokeStyle = {
      lineWidth: this.lineWidth,
      lineCap: this.lineCap,
      lineJoin: this.lineJoin,
      miterLimit: this.miterLimit,
    };
    const points: Pt[] =
      w === 0 && h === 0
        ? [{ x, y }]
        : w === 0 || h === 0
          ? [
              { x, y },
              { x: x + w, y: y + h },
            ]
          : [
              { x, y },
              { x: x + w, y },
              { x: x + w, y: y + h },
              { x, y: y + h },
            ];
    const closed = points.length === 4;
    for (const piece of strokePieces(points, closed, style)) {
      fillPolygons(this.mask, [piece], 'nonzero');
    }
  }
}

// ─── comparison ────────────────────────────────────────────────────────────

export interface MaskComparison {
  /** Pixels where the two disagree. */
  readonly mismatch: number;
  /**
   * Disagreements that are NOT on either shape's own edge — i.e. real
   * differences rather than a boundary landing on the other side of a pixel
   * centre. This is the number that must be zero: it says the two shapes agree
   * everywhere except within one pixel of their outlines (a Hausdorff bound),
   * which is the strongest statement a hard-sampled raster can make.
   */
  readonly deep: number;
  readonly filledA: number;
  readonly filledB: number;
  /** `|filledA − filledB| / max(filledA, filledB, 1)`. */
  readonly areaError: number;
  /** First deep mismatch, for a failure message that names a place. */
  readonly firstDeep: { readonly i: number; readonly j: number } | null;
}

function boundaryOf(mask: Mask): Uint8Array {
  const { n, bits } = mask;
  const edge = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const here = bits[j * n + i];
      let differs = false;
      for (let dj = -1; dj <= 1 && !differs; dj++) {
        for (let di = -1; di <= 1; di++) {
          const nj = j + dj;
          const ni = i + di;
          // Outside the grid counts as "other", so a shape running off the
          // square's edge is treated as bounded there rather than as interior.
          const value = ni < 0 || nj < 0 || ni >= n || nj >= n ? 1 - here : bits[nj * n + ni];
          if (value !== here) {
            differs = true;
            break;
          }
        }
      }
      if (differs) edge[j * n + i] = 1;
    }
  }
  return edge;
}

export function compareMasks(a: Mask, b: Mask): MaskComparison {
  if (a.n !== b.n) throw new Error('compareMasks: grids differ');
  const edgeA = boundaryOf(a);
  const edgeB = boundaryOf(b);
  let mismatch = 0;
  let deep = 0;
  let firstDeep: { i: number; j: number } | null = null;
  for (let j = 0; j < a.n; j++) {
    for (let i = 0; i < a.n; i++) {
      const k = j * a.n + i;
      if (a.bits[k] === b.bits[k]) continue;
      mismatch++;
      if (edgeA[k] || edgeB[k]) continue;
      deep++;
      firstDeep ??= { i, j };
    }
  }
  const filledA = a.filled;
  const filledB = b.filled;
  return {
    mismatch,
    deep,
    filledA,
    filledB,
    areaError: Math.abs(filledA - filledB) / Math.max(filledA, filledB, 1),
    firstDeep,
  };
}
