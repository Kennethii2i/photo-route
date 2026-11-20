import { expect, test } from 'vitest';
import { tripSchema } from '../../src/domain/model';

test('the TypeScript test pipeline loads the Phase 1 domain', () => {
  expect(tripSchema.safeParse({}).success).toBe(false);
});
