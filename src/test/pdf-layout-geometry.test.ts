import { describe, expect, it } from 'vitest';
import { __pdfGeometryInternals } from '@/utils/pdfImageExtractor';

const { rotationForContent } = __pdfGeometryInternals;

describe('PDF drawing geometry', () => {
  it('keeps a horizontal drawing upright even when its PDF page is very tall', () => {
    const horizontalInkAtPageEnd = { leftFrac: 0, rightFrac: 1, topFrac: 0.459, bottomFrac: 0.541 };
    expect(rotationForContent(horizontalInkAtPageEnd, 842, 4082)).toBe(0);
  });

  it('rotates content only when the drawing ink itself is tall', () => {
    const verticalInk = { leftFrac: 0.45, rightFrac: 0.55, topFrac: 0, bottomFrac: 1 };
    expect(rotationForContent(verticalInk, 2000, 412)).toBe(270);
  });
});
