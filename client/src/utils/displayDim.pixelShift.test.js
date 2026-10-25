import { describe, it, expect } from 'vitest';
import { PIXEL_SHIFT_OFFSETS, PIXEL_SHIFT_INTERVAL_MS, pixelShiftOffset, initDisplayDim } from './displayDim.js';

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
it('shifts with relative offsets, never a transform', () => {
    const root = { style: {}, dataset: {} };
    const bodyStyle = {};
    const el = { style: {}, classList: { toggle() {} } };
    let tick;
    globalThis.document = {
      documentElement: el,
      body: { style: bodyStyle, appendChild() {} },
      head: { appendChild() {} },
      getElementById: (id) => (id === 'root' ? root : {}),
      createElement: () => ({ style: {}, addEventListener() {} }),
    };
    globalThis.window = {
      addEventListener() {},
      setInterval: (fn) => { tick = fn; return 1; },
    };
    initDisplayDim();
    for (let i = 0; i < PIXEL_SHIFT_INTERVAL_MS / 1000; i++) tick();
    // Relative offsets leave the fixed dock, screensaver and theme scene
    // viewport-anchored; a transform on #root would capture them and push
    // the dock off screen, so the shift must not set one.
    expect(root.style.position).toBe('relative');
    expect(root.style.left).toBe('4px');
    expect(root.style.top).toBe('3px');
    expect(root.style.transform).toBeFalsy();
    expect(root.dataset.pixelShift).toBe('on');
    expect(bodyStyle.overflowX).toBe('hidden');
  });
});
