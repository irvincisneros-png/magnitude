import { describe, expect, it } from 'vitest';
import { cameraDistance, formatFriendly, formatSci, humanRatio, presence, viewHeightLocal } from '../src/engine/scale';

describe('scale', () => {
  it('view height is 1 local unit when s equals the landmark size', () => {
    expect(viewHeightLocal(Math.log10(1.27e7), 1.27e7)).toBeCloseTo(1, 10);
    expect(viewHeightLocal(-10, 1e-12)).toBeCloseTo(100, 8);
  });
  it('camera distance frames the view height at 45° fov', () => {
    expect(cameraDistance(0, 1)).toBeCloseTo(1 / (2 * Math.tan(Math.PI / 8)), 10);
  });
  it('presence fades in and out inside the range', () => {
    const r: [number, number] = [2, 6];
    expect(presence(1.9, r)).toBe(0);
    expect(presence(2.3, r)).toBeCloseTo(0.5, 5);
    expect(presence(4, r)).toBe(1);
    expect(presence(6.1, r)).toBe(0);
  });
  it('formats sizes', () => {
    expect(formatSci(1.5e-10)).toBe('1.5 × 10⁻¹⁰ m');
    expect(formatFriendly(1.5e-10)).toBe('150 pm');
    expect(formatFriendly(1.27e7)).toBe('12,700 km');
    expect(formatFriendly(8.8e26)).toBe('93 billion light-years');
  });
  it('human ratio', () => {
    expect(humanRatio(Math.log10(1.7))).toEqual({ exponent: 0, direction: 'same' });
    expect(humanRatio(7.1)).toEqual({ exponent: 7, direction: 'bigger' });
    expect(humanRatio(-9.8)).toEqual({ exponent: 10, direction: 'smaller' });
  });
});
