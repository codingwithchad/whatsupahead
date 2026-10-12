import { describe, expect, it } from 'vitest';
import { _addFrameForTest, getFrame, historyTargets, listFrames } from './history';

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

	it('returns saved frames oldest first and finds one by time', () => {
		_addFrameForTest('cam-a', { t: 1000, hash: 'a', jpeg: Buffer.from([1]) });
		_addFrameForTest('cam-a', { t: 2000, hash: 'b', jpeg: Buffer.from([2]) });
		expect(listFrames('cam-a')).toEqual([{ t: 1000 }, { t: 2000 }]);
		expect(getFrame('cam-a', 2000)?.[0]).toBe(2);
		expect(getFrame('cam-a', 9)).toBeNull();
		expect(listFrames('nope')).toBeNull();
	});
});
