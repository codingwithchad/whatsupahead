import { describe, expect, it } from 'vitest';
import {
	nevadaPassReport,
	nevadaStatus,
	type NevadaRoadReport,
	type NevadaStation
} from './nevada';
import type { IdahoEvent } from './idaho';
import { passAnswer } from './vehicle';

// A short line over Mount Rose Summit on SR 431, as a Google encoded polyline.
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

const PASS = { id: 'mt-rose', lat: 39.31163, lon: -119.89983, report: { route: 'SR 431' } };
const NOW = Date.UTC(2026, 11, 15, 20, 0);
const road = (status: string, extra: Partial<NevadaRoadReport> = {}): NevadaRoadReport => ({
	Id: 1,
	LocationDescription: 'From SR-28 to Mt Rose Summit',
	'Overall Status': status,
	'Secondary Conditions': [],
	RoadwayName: 'SR-431',
	EncodedPolyline: [
		encode([
			[39.25, -119.95],
			[39.31, -119.9],
			[39.35, -119.85]
		])
	],
	LastUpdated: NOW / 1000 - 600,
	...extra
});
const station: NevadaStation = {
	Id: 1,
	Latitude: 39.31163,
	Longitude: -119.89983,
	DeviceName: 'SR-431 Mt Rose Summit',
	AirTemperature: '24.1',
	LastUpdated: NOW / 1000 - 300
};

describe('nevadaStatus', () => {
	it("reads every one of NDOT's condition words", () => {
		expect(nevadaStatus('No Report')).toBeNull();
		expect(nevadaStatus('Chains or Snow Tires Required')).toBe('chains');
		expect(nevadaStatus('Chains Required, All Vehicles except 4-wheel drive with Snow tires')).toBe(
			'chains'
		);
		expect(nevadaStatus('Holding Traffic')).toBe('closed');
		expect(nevadaStatus('Road Closed')).toBe('closed');
		expect(nevadaStatus('Adverse Driving Conditions')).toBe('open');
		expect(nevadaStatus('Wind Alert - Vehicles over 9 feet use caution')).toBe('open');
		expect(nevadaStatus('HighWinds - Vehicles over 9 feet Prohibited')).toBe('open');
	});
});

describe('nevadaPassReport', () => {
	it('says no report when NDOT has none', () => {
		const r = nevadaPassReport(PASS, [road('No Report')], [], [station], { now: NOW });
		expect(r.status).toBe('off-season');
		expect(r.tempF).toBe(24.1);
	});

	it('gives chain controls, and the right answer for each vehicle', () => {
		const r1 = nevadaPassReport(PASS, [road('Chains or Snow Tires Required')], [], [], {
			now: NOW
		});
		expect(r1.status).toBe('chains');
		expect(passAnswer(r1, 'car').need).toBe('tires');
		expect(passAnswer(r1, 'tow').need).toBe('chains');

		const r2 = nevadaPassReport(
			PASS,
			[road('Chains Required, All Vehicles except 4-wheel drive with Snow tires')],
			[],
			[],
			{ now: NOW }
		);
		expect(passAnswer(r2, 'car').need).toBe('chains');
		expect(passAnswer(r2, 'awd')).toEqual({
			need: 'tires',
			text: 'Snow tires on all four wheels, or chains. Carry chains'
		});
	});

	it('is closed when NDOT closes or holds the road', () => {
		expect(nevadaPassReport(PASS, [road('Road Closed')], [], [], { now: NOW }).status).toBe(
			'closed'
		);
		const held = nevadaPassReport(PASS, [road('Holding Traffic')], [], [], { now: NOW });
		expect(held.status).toBe('closed');
		expect(held.label).toBe('Traffic held');
	});

	it('passes on wind and adverse conditions as a notice on an open road', () => {
		const r = nevadaPassReport(
			PASS,
			[road('Adverse Driving Conditions', { 'Secondary Conditions': ['Possible Snow'] })],
			[],
			[],
			{ now: NOW }
		);
		expect(r.status).toBe('open');
		expect(r.notice).toContain('Adverse Driving Conditions');
		expect(r.notice).toContain('Possible Snow');
	});

	it('ignores other roads, and is closed by a full closure event near the summit', () => {
		expect(
			nevadaPassReport(PASS, [road('Road Closed', { RoadwayName: 'SR-28' })], [], [], { now: NOW })
				.status
		).toBe('off-season');
		const closure: IdahoEvent = {
			ID: 1,
			RoadwayName: 'SR-431',
			Description: 'SR-431 closed at Mt Rose Summit due to a crash.',
			IsFullClosure: true,
			Latitude: 39.31,
			Longitude: -119.9,
			StartDate: NOW / 1000 - 600
		};
		const r = nevadaPassReport(PASS, [road('No Report')], [closure], [], { now: NOW });
		expect(r.status).toBe('closed');
		expect(r.road).toContain('crash');
	});
});
