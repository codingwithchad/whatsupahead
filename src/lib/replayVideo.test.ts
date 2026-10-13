import { describe, expect, it } from 'vitest';
import { frameTimes, snowLine } from './replayVideo';

describe('replay video', () => {
	const H = 3600_000;
	const start = Date.UTC(2026, 11, 15, 14, 0); // 6:00 AM Pacific
	const snow = {
		station: 'Stevens Pass',
		hourly: [
			{ t: start, in: 40 },
			{ t: start + H, in: 42 },
			{ t: start + 2 * H, in: 45 }
		]
	};

	it('says how much snow has fallen since the first picture, from the gauge', () => {
		expect(snowLine(snow, start, start + 2 * H, 'America/Los_Angeles')).toBe(
			'+5 in of new snow since 6:00 AM'
		);
		// Less than an inch, no reading, or no gauge: nothing is said.
		expect(
			snowLine({ ...snow, hourly: [] }, start, start + 2 * H, 'America/Los_Angeles')
		).toBeNull();
		expect(snowLine(null, start, start + H, 'America/Los_Angeles')).toBeNull();
		expect(
			snowLine(
				{
					...snow,
					hourly: [
						{ t: start, in: 40 },
						{ t: start + H, in: 40 }
					]
				},
				start,
				start + H,
				'America/Los_Angeles'
			)
		).toBeNull();
	});

	it('keeps the video about six seconds long whatever the number of pictures', () => {
		expect(frameTimes(12).each * 12).toBe(6000);
		expect(frameTimes(3).each).toBe(600);
		expect(frameTimes(80).each).toBe(180);
		expect(frameTimes(24).hold).toBe(1800);
	});
});
