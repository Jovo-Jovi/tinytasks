import { describe, expect, it } from 'vitest';
import { GET } from '../src/app/api/health/route';

describe('health', () => {
  it('returns 200', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
