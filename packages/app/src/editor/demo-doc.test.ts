import { describe, expect, it } from 'vitest';
import { patternCoverGeometry, PANEL_HEIGHT_MM, panelWidthMm } from '@zpd/core';
import { createDemoDoc } from './demo-doc';

function bbox(node: { x: number; y: number; width: number; height: number }) {
  return { minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height };
}

function intersects(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

describe('createDemoDoc fixed PCB stack', () => {
  it('keeps demo content inside canonical material containers', () => {
    const doc = createDemoDoc();
    expect(doc.layers.map((container) => container.role)).toEqual([
      'copper',
      'solder-mask',
      'silkscreen',
    ]);
    expect(doc.layers[0].children.map((node) => node.id)).toEqual([
      'layer-default-dot-grid',
      'demo-ellipse',
      'demo-path',
      'demo-image',
    ]);
    expect(doc.layers[1].children.map((node) => node.id)).toEqual(['demo-mask-opening']);
    expect(doc.layers[2].children.map((node) => node.id)).toEqual(['demo-rect', 'demo-text']);
  });

  it('positions the mask opening over the copper dot-grid pattern so the demo shows copper through a mask opening', () => {
    const doc = createDemoDoc();
    const maskOpening = bbox(
      doc.layers[1].children[0] as { x: number; y: number; width: number; height: number },
    );
    expect((doc.layers[1].children[0] as { color: number }).color).toBe(0); // black routes to solder-mask container

    // The dot-grid pattern (createDefaultDoc) covers a square centered on the
    // panel — the opening must sit inside it to reveal copper, not empty
    // canvas beyond the pattern's cover geometry.
    const cover = patternCoverGeometry({
      widthMm: panelWidthMm(doc.panelHp),
      heightMm: PANEL_HEIGHT_MM,
    });
    const coverBox = bbox({ x: cover.x, y: cover.y, width: cover.size, height: cover.size });
    expect(intersects(maskOpening, coverBox)).toBe(true);
    expect(maskOpening.minX).toBeGreaterThanOrEqual(coverBox.minX);
    expect(maskOpening.minY).toBeGreaterThanOrEqual(coverBox.minY);
    expect(maskOpening.maxX).toBeLessThanOrEqual(coverBox.maxX);
    expect(maskOpening.maxY).toBeLessThanOrEqual(coverBox.maxY);
  });

  it('keeps the mask opening clear of geometry several e2e specs assert against this exact demo doc (codex review finding)', () => {
    // editor-select.spec.ts / editor-composer-parity.spec.ts marquee-drag
    // (4,10)->(56,50) expects EXACTLY demo-ellipse + demo-rect selected, and
    // marquee-drag (5,2)->(50,11) expects an empty selection (asserts that
    // band is free of every leaf layer). A mask-opening leaf placed in
    // either box would silently break those assertions.
    const doc = createDemoDoc();
    const maskOpening = bbox(
      doc.layers[1].children[0] as { x: number; y: number; width: number; height: number },
    );
    const reservedMarquee = { minX: 4, minY: 10, maxX: 56, maxY: 50 };
    const reservedEmptyBand = { minX: 5, minY: 2, maxX: 50, maxY: 11 };

    expect(intersects(maskOpening, reservedMarquee)).toBe(false);
    expect(intersects(maskOpening, reservedEmptyBand)).toBe(false);

    // Also clear of every other fixed leaf's own bbox (rect, ellipse, image,
    // silkscreen text — demo-path is points-based, no x/y/width/height, and
    // is already covered by the reservedMarquee/reservedEmptyBand checks
    // above) — belt-and-suspenders beyond the two marquee boxes above.
    const otherLeaves = [
      ...doc.layers[0].children.filter((n) => n.id !== 'layer-default-dot-grid'),
      ...doc.layers[2].children,
    ] as Array<Partial<{ x: number; y: number; width: number; height: number }>>;
    for (const leaf of otherLeaves) {
      if (
        leaf.x === undefined ||
        leaf.y === undefined ||
        leaf.width === undefined ||
        leaf.height === undefined
      ) {
        continue;
      }
      expect(
        intersects(maskOpening, bbox({ x: leaf.x, y: leaf.y, width: leaf.width, height: leaf.height })),
      ).toBe(false);
    }
  });
});
