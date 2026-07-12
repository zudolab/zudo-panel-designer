// Fixtures below mirror the actual shape of @image-tracer-ts's SVG output
// (viewBox-only <svg>, `fill="rgb(r,g,b)"`, Q-curve `d` strings) — verified
// by tracing a real ImageData through @image-tracer-ts/browser locally.
import { describe, expect, it } from 'vitest';
import { svgToPathLayers } from './svg-to-path-layers';

const GOLD = 'rgb(212,175,55)'; // exact @zpd/core PALETTE gold -> index 1
const IDENTITY = { x: 0, y: 0, width: 10, height: 10 };

describe('svgToPathLayers', () => {
  it('preserves the closed flag on a Z-terminated path', () => {
    const svg = `<svg viewBox="0 0 10 10"><path fill="${GOLD}" d="M0 0L10 0L10 10L0 10Z" /></svg>`;
    const [layer] = svgToPathLayers(svg, IDENTITY);
    expect(layer.closed).toBe(true);
    expect(layer.points).toHaveLength(4);
  });

  it('reads source dims from width/height attrs when present, viewBox as fallback', () => {
    const svgWithAttrs = `<svg width="20" height="10"><path fill="${GOLD}" d="M0 0L20 0L20 10L0 10Z" /></svg>`;
    const svgViewBoxOnly = `<svg viewBox="0 0 20 10"><path fill="${GOLD}" d="M0 0L20 0L20 10L0 10Z" /></svg>`;
    const target = { x: 0, y: 0, width: 20, height: 10 };

    const fromAttrs = svgToPathLayers(svgWithAttrs, target)[0].points;
    const fromViewBox = svgToPathLayers(svgViewBoxOnly, target)[0].points;
    expect(fromAttrs).toEqual(fromViewBox);
  });

  it('scales points from source-SVG space into the target mm rect (offset + non-uniform scale)', () => {
    const svg = `<svg viewBox="0 0 100 50"><path fill="${GOLD}" d="M0 0L100 0L100 50L0 50Z" /></svg>`;
    const target = { x: 15, y: 25, width: 10, height: 5 }; // sx=0.1, sy=0.1
    const [layer] = svgToPathLayers(svg, target);
    expect(layer.points).toEqual([
      { x: 15, y: 25 },
      { x: 25, y: 25 },
      { x: 25, y: 30 },
      { x: 15, y: 30 },
    ]);
  });

  it('keeps a compound region (outer + hole) on ONE layer, hole in extraSubpaths', () => {
    // outer 0..20 square, inner 5..15 hole — one <path>, two M...Z subpaths,
    // same as how @image-tracer-ts emits a donut-shaped color region
    const d = 'M0 0L20 0L20 20L0 20Z M5 5L15 5L15 15L5 15Z';
    const svg = `<svg viewBox="0 0 20 20"><path fill="${GOLD}" d="${d}" /></svg>`;
    const layers = svgToPathLayers(svg, { x: 0, y: 0, width: 20, height: 20 });

    expect(layers).toHaveLength(1); // NOT split into two solid layers
    const [layer] = layers;
    expect(layer.closed).toBe(true);
    expect(layer.points).toHaveLength(4); // outer boundary
    expect(layer.extraSubpaths).toHaveLength(1);
    expect(layer.extraSubpaths?.[0]).toEqual([
      { x: 5, y: 5 },
      { x: 15, y: 5 },
      { x: 15, y: 15 },
      { x: 5, y: 15 },
    ]);
  });

  it('maps a near-gold fill to palette index 1 via OKLab distance', () => {
    // a muted/darker gold, not the exact palette hex — still nearest to gold
    const svg = `<svg viewBox="0 0 10 10"><path fill="rgb(200,165,45)" d="M0 0L10 0L10 10L0 10Z" /></svg>`;
    const [layer] = svgToPathLayers(svg, IDENTITY);
    expect(layer.fill).toBe(1);
  });

  it('skips fill="none" paths (not a panel color)', () => {
    const svg = `<svg viewBox="0 0 10 10"><path fill="none" d="M0 0L10 0L10 10L0 10Z" /></svg>`;
    expect(svgToPathLayers(svg, IDENTITY)).toHaveLength(0);
  });

  it('converts the tracer\'s quadratic Q curves into cubic bezier handles', () => {
    const svg = `<svg viewBox="0 0 20 20"><path fill="${GOLD}" d="M0 0Q10 20 20 0Z" /></svg>`;
    const [layer] = svgToPathLayers(svg, { x: 0, y: 0, width: 20, height: 20 });
    expect(layer.points).toHaveLength(2);
    expect(layer.points[0].hout).toBeDefined();
    expect(layer.points[1].hin).toBeDefined();
  });

  it('sets stroke to null and strokeWidth to 0 — traced layers are fill-only', () => {
    const svg = `<svg viewBox="0 0 10 10"><path fill="${GOLD}" d="M0 0L10 0L10 10L0 10Z" /></svg>`;
    const [layer] = svgToPathLayers(svg, IDENTITY);
    expect(layer.stroke).toBeNull();
    expect(layer.strokeWidth).toBe(0);
  });
});
