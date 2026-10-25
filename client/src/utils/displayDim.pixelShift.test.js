import { describe, it, expect } from 'vitest';
import { PIXEL_SHIFT_OFFSETS, PIXEL_SHIFT_INTERVAL_MS, pixelShiftOffset } from './displayDim.js';

// FORK ONLY (prod): pixel shift against LCD image persistence.
describe('pixel shift', () => {
  it('uses small offsets only', () => {
    expect(PIXEL_SHIFT_OFFSETS.length).toBeGreaterThan(1);
    for (const { x, y } of PIXEL_SHIFT_OFFSETS) {
      expect(Math.abs(x)).toBeLessThanOrEqual(4);
      expect(Math.abs(y)).toBeLessThanOrEqual(4);
    }
  });
  it('cycles deterministically and wraps', () => {
    expect(pixelShiftOffset(0)).toEqual(PIXEL_SHIFT_OFFSETS[0]);
    expect(pixelShiftOffset(PIXEL_SHIFT_OFFSETS.length)).toEqual(PIXEL_SHIFT_OFFSETS[0]);
    expect(pixelShiftOffset(-1)).toEqual(PIXEL_SHIFT_OFFSETS[PIXEL_SHIFT_OFFSETS.length - 1]);
  });
  it('steps slowly (minutes, not seconds)', () => {
    expect(PIXEL_SHIFT_INTERVAL_MS).toBeGreaterThanOrEqual(60 * 1000);
  });
});
