import { describe, expect, it } from 'vitest';
import { indexNowKey } from './indexNow';

describe('indexNowKey', () => {
	it('is the same for an address each time, and 32 letters and digits as IndexNow wants', () => {
		expect(indexNowKey('whatsupahead.com')).toBe(indexNowKey('whatsupahead.com'));
		expect(indexNowKey('whatsupahead.com')).toMatch(/^[0-9a-f]{32}$/);
		expect(indexNowKey('example.com')).not.toBe(indexNowKey('whatsupahead.com'));
	});
});
