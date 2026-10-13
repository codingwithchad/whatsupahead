import { describe, expect, it } from 'vitest';
import { _addFrameForTest, getFrame, historyTargets, listFrames, thin } from './history';

describe('history', () => {
	it('records only public-source, direct, non-seasonal cameras near passes', () => {
		const targets = historyTargets();
		expect(targets.length).toBeGreaterThan(20);
		for (const c of targets) {
			expect(c.provider, c.id).toBeUndefined();
			expect(['WSDOT', 'WSDOT Aviation', 'Caltrans', 'National Park Service'], c.id).toContain(
				c.source
			);
		}
		expect(targets.some((c) => c.id === 'wsdot-us2-mp63-big-windy')).toBe(true);
		expect(targets.some((c) => c.source === 'Caltrans')).toBe(true);
	});

	it('returns saved frames oldest first and finds one by time', async () => {
		_addFrameForTest('cam-a', { t: 1000, hash: 'a', jpeg: Buffer.from([1]) });
		_addFrameForTest('cam-a', { t: 2000, hash: 'b', jpeg: Buffer.from([2]) });
		expect(listFrames('cam-a')).toEqual([{ t: 1000 }, { t: 2000 }]);
		expect((await getFrame('cam-a', 2000))?.[0]).toBe(2);
		expect(await getFrame('cam-a', 9)).toBeNull();
		expect(listFrames('nope')).toBeNull();
	});

	it('keeps the last two hours in full and older pictures half an hour apart, for six hours', () => {
		const now = 10 * 60 * 60_000;
		const min = 60_000;
		// One picture every 5 minutes for the last 8 hours.
		const list = Array.from({ length: 97 }, (_, i) => ({ t: now - (96 - i) * 5 * min }));
		const kept = thin(list, now).map((f) => (now - f.t) / min);
		expect(kept.filter((age) => age <= 120)).toHaveLength(25);
		const older = kept.filter((age) => age > 120);
		expect(Math.max(...older)).toBeLessThanOrEqual(360);
		for (let i = 1; i < older.length; i++)
			expect(older[i - 1] - older[i]).toBeGreaterThanOrEqual(30);
		expect(older.length).toBeGreaterThanOrEqual(7);
	});
});
