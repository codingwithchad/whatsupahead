import { describe, expect, it } from 'vitest';
import type { IdahoEvent } from './idaho';
import {
	utahPassReport,
	utahStatus,
	utahSurface,
	type UtahRoadReport,
	type UtahStation
} from './utah';
import { needFor, passAnswer } from './vehicle';

// A short line up Little Cottonwood Canyon on SR 210, as a Google encoded polyline.
function encode(points: [number, number][]): string {
	let out = '';
	let pLat = 0;
	let pLon = 0;
	const one = (v: number) => {
		let n = v < 0 ? ~(v << 1) : v << 1;
		while (n >= 0x20) {
			out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
			n >>= 5;
		}
		out += String.fromCharCode(n + 63);
	};
	for (const [lat, lon] of points) {
		const a = Math.round(lat * 1e5);
		const b = Math.round(lon * 1e5);
		one(a - pLat);
		one(b - pLon);
		pLat = a;
		pLon = b;
	}
	return out;
}

const PASS = { id: 'little-cottonwood', lat: 40.592, lon: -111.6279, report: { route: 'SR 210' } };
const NOW = Date.UTC(2026, 11, 15, 20, 0);
const road = (over: Partial<UtahRoadReport> = {}): UtahRoadReport => ({
	Id: 1,
	RoadwayName: 'SR-210 Upper Little Cottonwood Canyon',
	RoadCondition: 'Snowy',
	WeatherCondition: 'Snow',
	Restriction: 'none',
	EncodedPolyline: encode([
		[40.572, -111.74],
		[40.58, -111.68],
		[40.592, -111.628]
	]),
	LastUpdated: NOW / 1000 - 600,
	...over
});
const station: UtahStation = {
	Id: 1,
	Latitude: 40.592,
	Longitude: -111.6279,
	StationName: 'SR-210 @ Alta',
	AirTemperature: '21.6',
	SurfaceTemp: '27.4',
	SurfaceStatus: 'Snow/Ice',
	LastUpdated: NOW / 1000 - 300
};

describe('utahStatus', () => {
	it("reads UDOT's restrictions", () => {
		expect(utahStatus({ Restriction: 'none', RoadCondition: 'Dry' })).toBe('open');
		expect(utahStatus({ Restriction: 'Chains Required', RoadCondition: 'Snowy' })).toBe('chains');
		expect(utahStatus({ Restriction: '4WD/AWD or Chains Required' })).toBe('chains');
		expect(utahStatus({ Restriction: 'Chains Recommended' })).toBe('traction');
		expect(utahStatus({ Restriction: 'none', RoadCondition: 'Closed' })).toBe('closed');
	});
});

describe('utahPassReport', () => {
	it('builds the pass report from the canyon report and the summit station', () => {
		const r = utahPassReport(
			PASS,
			[road({ Restriction: '4WD/AWD or Chains Required' })],
			[],
			[station],
			{ now: NOW }
		);
		expect(r).toMatchObject({ status: 'chains', weather: 'Snow', tempF: 22 });
		expect(r.road).toBe('Snowy (Upper Little Cottonwood Canyon)');
		expect(r.restrictions).toEqual([
			{ direction: 'Upper Little Cottonwood Canyon', text: '4WD/AWD or Chains Required' }
		]);
		expect(passAnswer(r, 'awd').text).toBe('AWD or 4WD with snow tires: no chains. Carry them');
		expect(passAnswer(r, 'car').need).toBe('chains');
	});

	it('says no report when the only report is old', () => {
		const r = utahPassReport(PASS, [road({ LastUpdated: NOW / 1000 - 30 * 86400 })], [], [], {
			now: NOW
		});
		expect(r.status).toBe('off-season');
		expect(r.label).toBe('No report');
	});

	it('closes the pass for a full closure on its road', () => {
		const closure: IdahoEvent = {
			ID: 1,
			RoadwayName: 'SR-210',
			Description: 'SR-210 closed at the mouth of the canyon for avalanche control.',
			IsFullClosure: true,
			Latitude: 40.585,
			Longitude: -111.66,
			StartDate: NOW / 1000 - 600
		};
		const r = utahPassReport(PASS, [road()], [closure], [], { now: NOW });
		expect(r.status).toBe('closed');
		expect(r.road).toContain('avalanche control');
	});
});

describe('Utah traction rule', () => {
	it('lets AWD with snow tires through and asks the rest for chains', () => {
		expect(needFor('Traction Law in effect', 'awd').need).toBe('tires');
		expect(needFor('Traction Law in effect', 'car').need).toBe('chains');
		expect(needFor('4WD/AWD or Chains Required', 'tow').need).toBe('chains');
	});
});

describe('utahSurface', () => {
	it('reads the pavement temperature, and leaves out old readings', () => {
		expect(utahSurface(station, NOW)).toMatchObject({ surfaceF: 27, airF: 22, wet: true });
		expect(utahSurface({ ...station, LastUpdated: NOW / 1000 - 3 * 3600 }, NOW)).toBeNull();
	});
});
