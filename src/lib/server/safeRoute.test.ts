import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Point } from '../geo';
import type { PassReport } from '../passes';
import type { PassInfo } from '../types';

// Two ways east over the mountains: the direct road over "North" pass, and a longer one over "South" pass.
const pass = (id: string, lat: number, lon: number): PassInfo => ({
	id,
	name: `${id} Pass`,
	route: 'US 1',
	connects: '',
	group: '',
	lat,
	lon,
	place: id
});
const NORTH = pass('North', 47.6, -121.0);
const SOUTH = pass('South', 47.0, -121.0);
const FROM = { lat: 47.6, lon: -122.0 };
const TO = { lat: 47.6, lon: -120.0 };

const reports = new Map<string, PassReport>();
const report = (status: PassReport['status']): PassReport => ({
	id: 0,
	status,
	label: status,
	restrictions: [],
	road: '',
	weather: '',
	tempF: null,
	advisory: false,
	updated: null
});

// A road drawn as many short steps between the given points, so passes can be found along it.
function line(points: Point[]) {
	const coords: [number, number][] = [];
	for (let i = 1; i < points.length; i++)
		for (let t = 0; t < 1; t += 0.02) {
			const [a, b] = [points[i - 1], points[i]];
			coords.push([a.lat + t * (b.lat - a.lat), a.lon + t * (b.lon - a.lon)]);
		}
	coords.push([points.at(-1)!.lat, points.at(-1)!.lon]);
	return coords;
}

vi.mock('./catalog', () => ({ getCatalog: () => ({ passes: [NORTH, SOUTH] }) }));
vi.mock('./passes', () => ({
	allPassReports: async (list: PassInfo[]) =>
		new Map(list.filter((p) => reports.has(p.id)).map((p) => [p.id, reports.get(p.id)!]))
}));
vi.mock('./trip', async () => {
	const { alongRoute } = await import('../route');
	return {
		passesOnRoute: (passes: PassInfo[], route: [number, number][], total: number) =>
			alongRoute(passes, route, { corridor: 2, destinationRadius: 0 })
				.filter((p) => p.along > 1 && p.along < total - 1)
				.map((p) => p.item)
	};
});
vi.mock('./routing', () => ({
	drivingRoute: async (from: Point, to: Point, via: Point[] = []) => {
		const south = via.some((v) => v.lat === SOUTH.lat);
		return {
			coords: line(south ? [from, SOUTH, to] : [from, NORTH, to]),
			miles: south ? 120 : 92,
			minutes: south ? 150 : 100
		};
	}
}));

const { safeRoute } = await import('./safeRoute');

describe('safeRoute', () => {
	beforeEach(() => reports.clear());

	it('keeps the direct road when its pass is open', async () => {
		reports.set('North', report('chains'));
		const r = await safeRoute(FROM, TO);
		expect(r.passes.map((p) => p.pass.id)).toEqual(['North']);
		expect(r.passes[0].report?.status).toBe('chains');
		expect(r.passes[0].heading).toBeGreaterThan(45);
		expect(r.avoided).toEqual([]);
	});

	it('goes over an open pass when the direct one is closed, and says so', async () => {
		reports.set('North', report('closed'));
		reports.set('South', report('open'));
		const r = await safeRoute(FROM, TO);
		expect(r.passes.map((p) => p.pass.id)).toEqual(['South']);
		expect(r.avoided).toEqual([{ closed: 'North Pass', instead: 'South Pass', extraMinutes: 50 }]);
		expect(r.blocked).toEqual([]);
	});

	it('says plainly when every way is closed', async () => {
		reports.set('North', report('closed'));
		reports.set('South', report('closed'));
		const r = await safeRoute(FROM, TO);
		expect(r.blocked).toEqual(['North Pass']);
		expect(r.avoided).toEqual([]);
	});
});
