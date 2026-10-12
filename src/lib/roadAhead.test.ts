import { describe, expect, it } from 'vitest';
import {
	alertsOnRoute,
	closuresOnRoute,
	inGeometry,
	odotClosure,
	samplePoints,
	wholeRoadClosed,
	wsdotClosure,
	type NwsAlert,
	type RoadClosure,
	type Sample
} from './roadAhead';
import { cumulativeMiles, headingAt, type LatLon } from './route';

describe('wholeRoadClosed', () => {
	it('finds whole-road closures', () => {
		expect(wholeRoadClosed('SR 165 is closed at the Carbon River/Fairfax Bridge.')).toBe(true);
		expect(wholeRoadClosed('I-90 is closed in both directions at Snoqualmie Pass')).toBe(true);
		expect(wholeRoadClosed('All lanes are blocked on US 2 near Skykomish')).toBe(true);
		expect(wholeRoadClosed('Full closure of SR 20 for avalanche control')).toBe(true);
	});
	it('leaves out lanes, shoulders, ramps and delays', () => {
		expect(
			wholeRoadClosed(
				'Up to four lanes of southbound I-405 from Northeast Eighth Street (milepost 14) to milepost 12 will be closed nightly'
			)
		).toBe(false);
		expect(wholeRoadClosed('On SR 18 westbound the right lane is closed due to maintenance.')).toBe(
			false
		);
		expect(wholeRoadClosed('Delays up to 15 minutes on Wednesday')).toBe(false);
		expect(wholeRoadClosed('The I-5 northbound on-ramp is closed')).toBe(false);
	});
});

describe('state closures', () => {
	const now = Date.UTC(2026, 9, 12, 18);
	it('reads a WSDOT alert in effect', () => {
		const c = wsdotClosure(
			{
				AlertID: 1,
				HeadlineDescription: 'SR 165 is closed at the bridge.',
				StartTime: `/Date(${now - 86400_000}-0700)/`,
				EndTime: null,
				StartRoadwayLocation: { Latitude: 47.07, Longitude: -122.04 },
				EndRoadwayLocation: { Latitude: 46.93, Longitude: -121.93 }
			},
			now
		);
		expect(c?.start).toEqual({ lat: 47.07, lon: -122.04 });
		expect(c?.end).toEqual({ lat: 46.93, lon: -121.93 });
	});
	it('skips WSDOT alerts that ended or start well later', () => {
		const base = {
			AlertID: 1,
			HeadlineDescription: 'SR 165 is closed at the bridge.',
			StartRoadwayLocation: { Latitude: 47.07, Longitude: -122.04 }
		};
		expect(wsdotClosure({ ...base, EndTime: `/Date(${now - 1000}-0700)/` }, now)).toBeNull();
		expect(
			wsdotClosure({ ...base, StartTime: `/Date(${now + 2 * 86400_000}-0700)/` }, now)
		).toBeNull();
	});
	it('reads ODOT closures but not ramps', () => {
		const loc = { 'start-location': { 'start-lat': 45.6, 'start-long': -121.2 } };
		expect(
			odotClosure({ 'impact-id': '4', headline: 'I-84 closed due to crash', location: loc })?.start
		).toEqual({ lat: 45.6, lon: -121.2 });
		expect(odotClosure({ 'impact-id': '4', headline: 'Ramp closed', location: loc })).toBeNull();
		expect(odotClosure({ 'impact-id': '2', headline: 'Delays', location: loc })).toBeNull();
	});
});

// A straight drive due east along 47.4 N, about 30 miles.
const road: LatLon[] = Array.from({ length: 31 }, (_, i) => [47.4, -121.8 + i * 0.0213]);
const cum = cumulativeMiles(road);

describe('closuresOnRoute', () => {
	const closure = (lat: number, lon: number): RoadClosure => ({
		source: 'WSDOT',
		headline: 'x',
		start: { lat, lon },
		end: { lat, lon },
		updated: null,
		link: ''
	});
	it('keeps closures on the road, in order, and drops ones off it', () => {
		const out = closuresOnRoute(
			[closure(47.4, -121.4), closure(47.4, -121.7), closure(47.5, -121.6)],
			road,
			cum
		);
		expect(out.map((c) => Math.round(c.along))).toEqual([5, 19]);
	});
});

describe('weather warnings', () => {
	const square = {
		type: 'Polygon',
		coordinates: [
			[
				[-121.6, 47.3],
				[-121.5, 47.3],
				[-121.5, 47.5],
				[-121.6, 47.5],
				[-121.6, 47.3]
			]
		]
	};
	it('tests points against drawn areas', () => {
		expect(inGeometry({ lat: 47.4, lon: -121.55 }, square)).toBe(true);
		expect(inGeometry({ lat: 47.4, lon: -121.7 }, square)).toBe(false);
		expect(
			inGeometry(
				{ lat: 47.4, lon: -121.55 },
				{ type: 'MultiPolygon', coordinates: [square.coordinates] }
			)
		).toBe(true);
	});

	const start = Date.UTC(2026, 11, 1, 20);
	const samples: Sample[] = samplePoints(road, cum, 30, start, 5).map((s) => ({
		...s,
		zones: s.lon > -121.6 ? ['WAZ522', 'WAC037'] : ['WAZ555']
	}));
	const alert = (
		over: Partial<NwsAlert['properties']>,
		geometry: NwsAlert['geometry'] = null
	): NwsAlert => ({
		id: 'a',
		geometry,
		properties: {
			event: 'Winter Storm Warning',
			status: 'Actual',
			messageType: 'Alert',
			onset: new Date(start).toISOString(),
			ends: new Date(start + 6 * 3600_000).toISOString(),
			geocode: { UGC: ['WAZ522'] },
			...over
		}
	});

	it('finds a warning in a zone you drive through while it is in effect', () => {
		const [a] = alertsOnRoute([alert({})], samples);
		expect(a.event).toBe('Winter Storm Warning');
		expect(a.tone).toBe('danger');
		expect(a.fromMile).toBeGreaterThan(7);
	});
	it('skips warnings that end before you get there, start after you pass, or do not matter on the road', () => {
		expect(
			alertsOnRoute([alert({ ends: new Date(start - 60_000).toISOString() })], samples)
		).toEqual([]);
		expect(
			alertsOnRoute([alert({ onset: new Date(start + 3 * 3600_000).toISOString() })], samples)
		).toEqual([]);
		expect(alertsOnRoute([alert({ event: 'Frost Advisory' })], samples)).toEqual([]);
		expect(alertsOnRoute([alert({ messageType: 'Cancel' })], samples)).toEqual([]);
	});
	it('uses the drawn area when the alert has one', () => {
		const [a] = alertsOnRoute([alert({ event: 'Flash Flood Warning' }, square)], samples);
		expect(a.fromMile).toBeGreaterThan(9);
		expect(a.toMile).toBeLessThan(15);
	});
	it('merges the same warning from two offices', () => {
		const out = alertsOnRoute(
			[alert({}), { ...alert({ geocode: { UGC: ['WAC037'] } }), id: 'b' }],
			samples
		);
		expect(out).toHaveLength(1);
	});
});

describe('samplePoints and headingAt', () => {
	it('spaces points and times them', () => {
		const pts = samplePoints(road, cum, 60, 0, 8);
		expect(pts[0].along).toBe(0);
		expect(pts.at(-1)!.along).toBeCloseTo(cum.at(-1)!);
		expect(pts.at(-1)!.at).toBe(60 * 60_000);
	});
	it('reads the way the road heads', () => {
		expect(headingAt(road, cum, 10)).toBeCloseTo(90, 0);
		expect(headingAt([...road].reverse(), cum, 10)).toBeCloseTo(270, 0);
	});
});
