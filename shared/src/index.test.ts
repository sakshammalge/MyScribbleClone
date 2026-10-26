import { describe, expect, it } from 'vitest';
import { SETTINGS_LIMITS } from './index';

describe('SETTINGS_LIMITS', () => {
  it('keeps defaults inside their ranges', () => {
    for (const { min, max, default: def } of Object.values(SETTINGS_LIMITS)) {
      expect(def).toBeGreaterThanOrEqual(min);
      expect(def).toBeLessThanOrEqual(max);
    }
  });
});
