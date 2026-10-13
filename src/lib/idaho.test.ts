import { describe, expect, it } from 'vitest';
import {
	decodePolyline,
	eventInEffect,
	idahoClosure,
	idahoPassReport,
	idahoSurface,
	reportLines,
	sameIdahoRoad,
	type IdahoEvent,
	type IdahoRoadReport,
	type IdahoStation
} from './idaho';

// Google's own example line: (38.5, -120.2), (40.7, -120.95), (43.252, -126.453).
const EXAMPLE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

// A short line over Fourth of July Pass on I-90, encoded the same way.
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

const PASS = {
	id: 'fourth-of-july',
	lat: 47.61932,
	lon: -116.52055,
	report: { route: 'I 90', station: '246.C1' }
};
const OVER_PASS = encode([
	[47.63, -116.6],
	[47.62, -116.52],
	[47.55, -116.45]
]);
const NOW = Date.UTC(2026, 11, 15, 20, 0); // 1 PM Mountain standard time, a Tuesday

const road = (status: string, extra: Partial<IdahoRoadReport> = {}): IdahoRoadReport => ({
	Id: 1,
	LocationDescription: "I-90, between Coeur d'Alene and Kellogg",
	'Overall Status': status,
	'Weather Conditions': [],
	'Special Conditions': [],
	RoadwayName: 'I-90',
	EncodedPolyline: JSON.stringify([OVER_PASS]),
	LastUpdated: NOW / 1000 - 600,
	...extra
});

const station: IdahoStation = {
	Id: '1',
	Name: 'D1 - 4th of July Pass',
	Latitude: '47.6155',
	Longitude: '-116.5167',
	LastUpdated: String(NOW / 1000 - 300),
	AirTemperature: '27.4',
	SurfaceTemperature: '30.1',
	SurfaceStatus: 'Wet',
	Precipitation6H: '0.02',
	CameraSourceId: '246.C1'
};

describe('Idaho 511 lines and roads', () => {
	it('decodes encoded polylines', () => {
		const pts = decodePolyline(EXAMPLE);
		expect(pts).toEqual([
			{ lat: 38.5, lon: -120.2 },
			{ lat: 40.7, lon: -120.95 },
			{ lat: 43.252, lon: -126.453 }
		]);
	});

	it('reads the line list whether it comes as a list or as text', () => {
		expect(reportLines([EXAMPLE])).toHaveLength(1);
		expect(reportLines(JSON.stringify([EXAMPLE, EXAMPLE]))).toHaveLength(2);
		expect(reportLines(EXAMPLE)[0]).toHaveLength(3);
		expect(reportLines(null)).toEqual([]);
	});

	it('matches the same highway however it is written', () => {
		expect(sameIdahoRoad('I-90', 'I 90')).toBe(true);
		expect(sameIdahoRoad('US-95', 'US 95')).toBe(true);
		expect(sameIdahoRoad('SH-21', 'SH 21')).toBe(true);
		expect(sameIdahoRoad('ID-21', 'SH 21')).toBe(true);
		expect(sameIdahoRoad('SH-55 Eagle', 'SH 55')).toBe(true);
		expect(sameIdahoRoad('I-84', 'I 90')).toBe(false);
		expect(sameIdahoRoad('US-20', 'US 2')).toBe(false);
		expect(sameIdahoRoad('CO-17', 'SH 17')).toBe(false);
	});
});

describe('idahoPassReport', () => {
	it('says no report when the crews have not reported', () => {
		const r = idahoPassReport(PASS, [road('No Report')], [], [station], { now: NOW });
		expect(r.status).toBe('off-season');
		expect(r.label).toBe('No crew report');
		// The summit station still gives the temperature.
		expect(r.tempF).toBe(27.4);
	});

	it('is open on a dry or wet road', () => {
		expect(idahoPassReport(PASS, [road('Dry')], [], [], { now: NOW }).status).toBe('open');
		const wet = idahoPassReport(PASS, [road('Wet', { 'Weather Conditions': ['Rain'] })], [], [], {
			now: NOW
		});
		expect(wet.status).toBe('open');
		expect(wet.weather).toBe('Rain');
		expect(wet.road).toContain('Wet');
	});

	it('says carry chains when crews report snow or ice', () => {
		for (const words of [
			'Snow Covered',
			'Icy Spots',
			'Slushy',
			'Packed Snow',
			'Scattered Snow and Ice'
		]) {
			const r = idahoPassReport(PASS, [road(words)], [], [], { now: NOW });
			expect(r.status, words).toBe('traction');
			expect(r.label).toBe('Snow or ice: carry chains');
		}
		// Snow in the weather, on a wet road, is winter driving too.
		const falling = idahoPassReport(
			PASS,
			[road('Wet', { 'Weather Conditions': ['Snow'] })],
			[],
			[],
			{ now: NOW }
		);
		expect(falling.status).toBe('traction');
	});

	it('passes on travel not advised as a notice', () => {
		const r = idahoPassReport(
			PASS,
			[road('Snow Covered', { 'Special Conditions': ['Travel Not Advised'] })],
			[],
			[],
			{ now: NOW }
		);
		expect(r.status).toBe('traction');
		expect(r.notice).toContain('Snow Covered');
	});

	it('ignores reports for other roads or far from the pass', () => {
		expect(
			idahoPassReport(PASS, [road('Snow Covered', { RoadwayName: 'SH-3' })], [], [], { now: NOW })
				.status
		).toBe('off-season');
		const far = encode([
			[47.3, -116.0],
			[47.2, -115.9]
		]);
		expect(
			idahoPassReport(
				PASS,
				[road('Snow Covered', { EncodedPolyline: JSON.stringify([far]) })],
				[],
				[],
				{ now: NOW }
			).status
		).toBe('off-season');
	});

	it('is closed when a full closure on the road is in effect near the pass', () => {
		const closure: IdahoEvent = {
			ID: 9,
			RoadwayName: 'I-90',
			Description: 'Crash on I-90 Eastbound at Fourth of July Pass. All lanes closed.',
			EventType: 'closures',
			IsFullClosure: true,
			Latitude: 47.6,
			Longitude: -116.5,
			StartDate: NOW / 1000 - 3600,
			LastUpdated: NOW / 1000 - 60
		};
		const r = idahoPassReport(PASS, [road('Icy Spots')], [closure], [], { now: NOW });
		expect(r.status).toBe('closed');
		expect(r.road).toContain('All lanes closed');
		// One that has ended does not count.
		expect(
			idahoPassReport(PASS, [road('Dry')], [{ ...closure, PlannedEndDate: NOW / 1000 - 60 }], [], {
				now: NOW
			}).status
		).toBe('open');
	});

	it('reads a chain requirement in an event', () => {
		const chains: IdahoEvent = {
			ID: 10,
			RoadwayName: 'I-90',
			DirectionOfTravel: 'Eastbound',
			Description: 'Chains required on commercial vehicles over 10,000 GVW on I-90 Eastbound.',
			IsFullClosure: false,
			Latitude: 47.6,
			Longitude: -116.5,
			StartDate: NOW / 1000 - 3600
		};
		const r = idahoPassReport(PASS, [road('Snow Covered')], [chains], [], { now: NOW });
		expect(r.status).toBe('chains');
		expect(r.restrictions[0].direction).toBe('Eastbound');
	});
});

describe('eventInEffect', () => {
	const nightly: IdahoEvent = {
		ID: 1,
		StartDate: NOW / 1000 - 86400,
		RecurrenceSchedules: [
			{
				Times: [{ StartTime: '20:00:00-07:00:00', EndTime: '06:00:00-07:00:00' }],
				DaysOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
			}
		]
	};

	it('follows the hours of a closure that repeats', () => {
		// 1 PM: not in its hours.
		expect(eventInEffect(nightly, NOW)).toBe(false);
		// 9 PM Mountain time (UTC-7 as the times say) on the same Tuesday.
		expect(eventInEffect(nightly, Date.UTC(2026, 11, 16, 4, 0))).toBe(true);
	});

	it('checks start and planned end', () => {
		expect(eventInEffect({ ID: 2, StartDate: NOW / 1000 + 3600 }, NOW)).toBe(false);
		expect(eventInEffect({ ID: 3, StartDate: NOW / 1000 - 3600 }, NOW)).toBe(true);
	});
});

describe('idahoClosure and idahoSurface', () => {
	it('keeps full closures of state highways only', () => {
		const base: IdahoEvent = {
			ID: 1,
			RoadwayName: 'US-95',
			Description: 'Rock slide on US-95. All lanes closed.',
			IsFullClosure: true,
			Latitude: 45.8,
			Longitude: -116.3,
			StartDate: NOW / 1000 - 600
		};
		expect(idahoClosure(base, NOW)?.source).toBe('ITD');
		expect(idahoClosure({ ...base, RoadwayName: 'N McDermott Rd' }, NOW)).toBeNull();
		expect(idahoClosure({ ...base, IsFullClosure: false }, NOW)).toBeNull();
	});

	it("reads a station's pavement temperature, and leaves out old readings", () => {
		const r = idahoSurface(station, NOW);
		expect(r).toMatchObject({ name: '4th of July Pass', surfaceF: 30, airF: 27, wet: true });
		expect(
			idahoSurface({ ...station, LastUpdated: String(NOW / 1000 - 3 * 3600) }, NOW)
		).toBeNull();
		expect(idahoSurface({ ...station, SurfaceTemperature: 'None' }, NOW)).toBeNull();
	});
});
