import { describe, it, expect } from 'vitest';
import { applyKioskUrlOverrides } from './displayDim.js';

// FORK ONLY (prod): kiosk URL overrides restored for the household's
// touchscreen launch URL. Upstream dropped these in the #334 rework.
const base = { enabled: false, day: 0.7, night: 0.03, after: 20, nightStart: 0, nightEnd: 6 };

describe('applyKioskUrlOverrides', () => {
  it('passes settings through with no params', () => {
    expect(applyKioskUrlOverrides(base, '')).toEqual(base);
    expect(applyKioskUrlOverrides(base, '?theme=autumn')).toEqual(base);
  });
  it('forces enabled and overrides the day level with ?dim', () => {
    expect(applyKioskUrlOverrides(base, '?dim=0.5')).toMatchObject({ enabled: true, day: 0.5, night: 0.03 });
  });
  it('overrides night, idle delay, and the night window', () => {
    expect(applyKioskUrlOverrides(base, '?dimNight=0.08&dimAfter=60&nightStart=22&nightEnd=5')).toMatchObject({ enabled: true, night: 0.08, after: 60, nightStart: 22, nightEnd: 5 });
  });
  it('allows dimAfter=0 (always dimmed)', () => {
    expect(applyKioskUrlOverrides(base, '?dimAfter=0')).toMatchObject({ enabled: true, after: 0 });
  });
  it('clamps levels to 0-1 and hours to 0-23', () => {
    expect(applyKioskUrlOverrides(base, '?dim=2&dimNight=-0.5&nightStart=25')).toMatchObject({ day: 1, night: 0, nightStart: 23 });
  });
  it('ignores invalid values', () => {
    expect(applyKioskUrlOverrides(base, '?dim=abc&dimAfter=-5')).toMatchObject({ enabled: true, day: 0.7, after: 20 });
  });
});
