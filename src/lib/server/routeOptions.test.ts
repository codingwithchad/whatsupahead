import { describe, expect, it, vi } from 'vitest';
import type { Point } from '../geo';
import type { PassInfo } from '../types';

// Two ways east: the direct road over "North" pass and a longer one over "South" pass, in the same range.
const pass = (id: string, lat: number, over: Partial<PassInfo> = {}): PassInfo => ({
	id,
	name: `${id} Pass`,
	route: 'US 1',
	connects: '',
	group: 'Cascades',
	lat,
	lon: -121,
	place: id,
	...over
});
const NORTH = pass('North', 47.6);
const SOUTH = pass('South', 47.0);
const WINTER = pass('Winter', 47.3, { winter_closure: 'Closed for the winter' });
const FAR = pass('Far', 40.0);

vi.mock('./catalog', () => ({ getCatalog: () => ({ passes: [NORTH, SOUTH, WINTER, FAR] }) }));
vi.mock('./passes', () => ({ allPassReports: async () => new Map() }));
vi.mock('./tripLive', () => ({
	passesNow: async (coords: [number, number][]) => {
		const lat = coords[Math.floor(coords.length / 2)][0];
		const p = [NORTH, SOUTH, WINTER].find((x) => Math.abs(x.lat - lat) < 0.05)!;
		return [
			{
				id: p.id,
				name: p.name,
				route: p.route,
				place: p.place,
				link: null,
				source: 'WSDOT',
				along: 50,
				heading: 90,
				report: null,
				lat: p.lat,
				lon: p.lon
			}
		];
	}
}));
const calls: { free?: boolean }[] = [];
vi.mock('./routing', () => ({
	drivingRoute: async (from: Point, to: Point, via: Point[], opts: { free?: boolean }) => {
		calls.push(opts);
		const mid = via[0] ?? NORTH;
		return {
			coords: [
				[from.lat, from.lon],
				[mid.lat, mid.lon],
				[to.lat, to.lon]
			],
			miles: 100 + Math.abs(mid.lat - 47.6) * 60,
			minutes: 100 + Math.abs(mid.lat - 47.6) * 90
		};
	}
}));

const { routeOptions, thinLine } = await import('./routeOptions');

describe('routeOptions', () => {
	it('offers the other passes across the same range, with free routing only', async () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 6, 10) });
		const out = await routeOptions(
			{ lat: 47.6, lon: -122 },
			{ lat: 47.6, lon: -120 },
			{ passes: [{ pass: NORTH }] }
		);
		vi.useRealTimers();
		// Summer: the winter road is a way across, and the shorter one comes first. Far is another range.
		expect(out.options.map((o) => o.pass.id)).toEqual(['Winter', 'South']);
		expect(calls.every((c) => c.free === true)).toBe(true);
	});
	it('in deep winter, leaves out a road that closes for the winter', async () => {
		vi.useFakeTimers({ now: Date.UTC(2027, 0, 10) });
		const out = await routeOptions(
			{ lat: 47.6, lon: -122 },
			{ lat: 47.6, lon: -120 },
			{ passes: [{ pass: NORTH }] }
		);
		expect(out.options.map((o) => o.pass.id)).not.toContain('Winter');
		vi.useRealTimers();
	});
	it('offers nothing for a drive over no pass', async () => {
		expect(
			await routeOptions({ lat: 47.6, lon: -122 }, { lat: 47.6, lon: -121.9 }, { passes: [] })
		).toEqual({ baseline: null, options: [] });
	});
	it('leaves out ways much longer than the drive', async () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 6, 10) });
		const out = await routeOptions(
			{ lat: 47.6, lon: -122 },
			{ lat: 47.6, lon: -120 },
			{ passes: [{ pass: NORTH }] }
		);
		vi.useRealTimers();
		// The drive takes 100 min; South adds 54 (fine), and nothing here adds more than an hour.
		expect(out.baseline).toBe(100);
		expect(out.options.every((o) => o.minutes <= 160)).toBe(true);
		expect(out.options[0].label).toBe('Winter Pass');
	});

	it('thins a line and keeps both ends', () => {
		const line = Array.from({ length: 1000 }, (_, i) => [i, i] as [number, number]);
		const thin = thinLine(line, 10);
		expect(thin).toHaveLength(10);
		expect(thin[0]).toEqual([0, 0]);
		expect(thin.at(-1)).toEqual([999, 999]);
	});
});
