import { describe, expect, it } from 'vitest';
import type { SnowReading } from './mountain';
import { bySnow, hasNewSnow, postText, snowFacts, type SnowingSpot } from './snowing';

const HOUR = 3600_000;
// 2 PM in Seattle on a winter day.
const NOW = Date.parse('2026-12-10T14:00:00-08:00');

function reading(inches: number[], waterUp = 0.5): SnowReading {
	// One reading an hour, the last one now; the water in the snow rises evenly by `waterUp` over the readings.
	const hourly = inches.map((v, i) => ({ t: NOW - (inches.length - 1 - i) * HOUR, in: v }));
	const water = hourly.map((h, i) => ({ t: h.t, in: 2 + (waterUp * i) / (hourly.length - 1) }));
	return {
		station: 'Stevens Pass',
		elevation_ft: 3950,
		miles: 1,
		depthIn: inches.at(-1)!,
		change24: inches.at(-1)! - inches[0],
		hourly,
		water,
		tempF: 28,
		at: NOW,
		link: 'https://wcc.sc.egov.usda.gov/nwcc/site?sitenum=791'
	};
}

const steady = (from: number, perHour: number, hours = 25) =>
	Array.from({ length: hours }, (_, i) => from + Math.floor(i * perHour));

describe('snowFacts', () => {
	it('calls a gauge rising all day snowing now', () => {
		const f = snowFacts(reading(steady(10, 0.5)), null, 'America/Los_Angeles', NOW);
		expect(f.now).toBe(true);
		expect(f.last3).toBeGreaterThanOrEqual(1);
		expect(f.sinceSix).toBe(4);
	});

	it('does not call one inch of wobble snow', () => {
		const flat = Array.from({ length: 25 }, () => 20);
		flat[flat.length - 1] = 21;
		const f = snowFacts(reading(flat), null, 'America/Los_Angeles', NOW);
		expect(f.now).toBe(false);
		expect(hasNewSnow({ ...f })).toBe(false);
	});

	it('does not call a depth rise snow when the water in the snow stayed the same', () => {
		const f = snowFacts(reading(steady(10, 0.5), 0), null, 'America/Los_Angeles', NOW);
		expect(f.now).toBe(false);
		expect(f.change24).toBeNull();
		expect(hasNewSnow({ ...f })).toBe(false);
	});

	it('reads the water rise across hours the gauge skipped', () => {
		const r = reading(steady(10, 0.5));
		// No water readings for the first 12 hours, as gauges sometimes do.
		const f = snowFacts({ ...r, water: r.water.slice(12) }, null, 'America/Los_Angeles', NOW);
		expect(f.now).toBe(true);
	});

	it('trusts the state report saying snow, but not "no snow"', () => {
		const flat = reading(Array.from({ length: 25 }, () => 20));
		const tz = 'America/Los_Angeles';
		expect(snowFacts(flat, { text: 'Light snow', by: 'WSDOT' }, tz, NOW).now).toBe(true);
		expect(snowFacts(flat, { text: 'No snow on roadway', by: 'WSDOT' }, tz, NOW).now).toBe(false);
		expect(snowFacts(null, { text: 'Cloudy', by: 'WSDOT' }, tz, NOW).reported).toBe(null);
	});

	it('ignores a gauge that stopped reporting hours ago', () => {
		const old = { ...reading(steady(10, 0.5)), at: NOW - 8 * HOUR };
		expect(snowFacts(old, null, 'America/Los_Angeles', NOW).now).toBe(false);
	});
});

const spot = (over: Partial<SnowingSpot>): SnowingSpot => ({
	id: 'stevens',
	name: 'Stevens Pass',
	kind: 'pass',
	state: 'WA',
	href: '/passes/stevens',
	pictured: true,
	preview: '/og/search?place=pass-stevens',
	gauge: 'Stevens Pass',
	gaugeFeet: 3950,
	gaugeMiles: 1,
	gaugeLink: null,
	last3: 2,
	sinceSix: 6,
	change24: 9,
	reported: null,
	now: true,
	...over
});

describe('postText', () => {
	it('says how much snow, at what height, and links the cameras', () => {
		expect(postText(spot({}), 'https://whatsupahead.com')).toBe(
			'Snowing at Stevens Pass: 2 in in the last 3 hours, 6 in since 6 AM at the USDA snow gauge at 3,950 ft. Every camera and the pass report in one place: https://whatsupahead.com/passes/stevens'
		);
	});

	it('says "near" and how far away when the gauge is miles from the spot', () => {
		const s = spot({
			name: 'Beaver Mountain',
			gaugeFeet: 8610,
			gaugeMiles: 7.4,
			sinceSix: 0,
			change24: 3
		});
		expect(postText(s, 'https://whatsupahead.com')).toMatch(
			/^Snowing near Beaver Mountain: 2 in in the last 3 hours, 3 in in 24 hours at the USDA snow gauge 7 mi away, at 8,610 ft\./
		);
	});

	it('falls back to the state report when the gauge shows nothing yet', () => {
		const s = spot({
			last3: 0,
			sinceSix: 0,
			change24: 0,
			reported: { text: 'Snowing', by: 'WSDOT' }
		});
		expect(postText(s, 'https://whatsupahead.com')).toMatch(
			/^WSDOT reports snowing at Stevens Pass\./
		);
	});
});

describe('bySnow', () => {
	it('puts snowing now first, then the most snow', () => {
		const list = [
			spot({ id: 'a', name: 'A', now: false, sinceSix: 12 }),
			spot({ id: 'b', name: 'B', sinceSix: 3, change24: 3 }),
			spot({ id: 'c', name: 'C', sinceSix: 8, change24: 8 })
		].sort(bySnow);
		expect(list.map((s) => s.id)).toEqual(['c', 'b', 'a']);
	});
});
