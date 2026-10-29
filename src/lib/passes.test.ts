import { describe, expect, it } from 'vitest';
import {
	blocksRoad,
	caltransPassReport,
	inClosedSeason,
	checkpointName,
	classifyPass,
	classifyRestriction,
	odotPassReport,
	toneOf,
	type CaltransChainControl,
	type CaltransClosure,
	type OdotIncident,
	type OdotRwReport,
	type RawPass
} from './passes';

const pass = (over: Partial<RawPass>): RawPass => ({
	MountainPassId: 1,
	MountainPassName: 'Test',
	...over
});
const r = (text: string, dir = 'Eastbound') => ({ RestrictionText: text, TravelDirection: dir });

describe('classifyRestriction', () => {
	it('reads the common wordings', () => {
		expect(classifyRestriction('No restrictions')).toBe('open');
		expect(classifyRestriction('Traction tires advised')).toBe('traction');
		expect(classifyRestriction('Chains required on all vehicles except all wheel drive')).toBe(
			'chains'
		);
		expect(classifyRestriction('Chains required on all vehicles')).toBe('chains');
		expect(classifyRestriction('Closed')).toBe('closed');
		expect(classifyRestriction('Pass closed for avalanche control')).toBe('closed');
		expect(classifyRestriction('No current information available')).toBe('off-season');
	});

	it('does not read a negative as a requirement', () => {
		expect(classifyRestriction('No chains required')).not.toBe('chains');
		expect(classifyRestriction('Reopened, chains not required')).toBe('open');
	});
});

describe('classifyPass', () => {
	it('takes the worse of the two directions', () => {
		const p = classifyPass(
			pass({
				RestrictionOne: r('No restrictions'),
				RestrictionTwo: r('Chains required on all vehicles except all wheel drive', 'Westbound'),
				RoadCondition: 'Snow and ice on the road.'
			})
		);
		expect(p.status).toBe('chains');
		expect(p.restrictions).toHaveLength(2);
	});

	it('treats a closure in the road report as closed', () => {
		expect(
			classifyPass(
				pass({
					RestrictionOne: r('No restrictions'),
					RoadCondition: 'SR 20 is closed for the winter between Newhalem and Mazama.'
				})
			).status
		).toBe('closed');
		expect(
			classifyPass(
				pass({
					RestrictionOne: r('No restrictions'),
					RoadCondition: 'The road was closed overnight and has reopened.'
				})
			).status
		).toBe('open');
	});

	it('is off-season when WSDOT has stopped reporting, even with "No restrictions"', () => {
		const p = classifyPass(
			pass({
				RestrictionOne: r('No restrictions'),
				RoadCondition:
					'Reports have ended for this season. Traditionally weather and road conditions are reported from November 1 to April 1.'
			})
		);
		expect(p.status).toBe('off-season');
		expect(p.label).toBe('No report yet');
	});

	it('is open in season with no restrictions', () => {
		const p = classifyPass(
			pass({
				RestrictionOne: r('No restrictions'),
				RestrictionTwo: r('No restrictions', 'Westbound'),
				RoadCondition: 'Bare and dry.',
				TemperatureInFahrenheit: 34,
				WeatherCondition: 'Overcast'
			})
		);
		expect(p.status).toBe('open');
		expect(p.tempF).toBe(34);
	});

	it('survives empty reports', () => {
		expect(classifyPass(pass({})).status).toBe('off-season');
	});
});

describe('old reports', () => {
	const now = Date.parse('2026-10-11T12:00:00Z');
	const at = (ms: number) => `/Date(${ms}-0700)/`;
	const report = (daysAgo: number, text = 'No restrictions') =>
		classifyPass(
			{
				MountainPassId: 8,
				MountainPassName: 'Satus Pass US 97',
				RoadCondition: 'Bare and dry',
				RestrictionOne: { RestrictionText: text, TravelDirection: 'Northbound' },
				RestrictionTwo: { RestrictionText: text, TravelDirection: 'Southbound' },
				DateUpdated: at(now - daysAgo * 86_400_000)
			} as never,
			{ now }
		);

	it('trusts a recent report', () => {
		expect(report(1).status).toBe('open');
	});

	it('does not call a weeks-old report open', () => {
		const p = report(28);
		expect(p.status).toBe('off-season');
		expect(p.label).toBe('No recent report');
	});

	it('still shows an old closure as closed', () => {
		expect(report(28, 'Pass closed due to a collision').status).toBe('closed');
	});
});

describe('Oregon pass reports (ODOT)', () => {
	const santiam = {
		id: 'santiam',
		lat: 44.4248,
		lon: -121.8455,
		report: { source: 'odot' as const, route: 'US20' }
	};
	const now = Date.parse('2026-12-10T12:00:00Z');
	const rw = (over: Partial<OdotRwReport> = {}): OdotRwReport => ({
		'entry-time': '2026-12-10T10:00:00Z',
		'expiry-time': '2026-12-10T22:00:00Z',
		location: {
			'location-name': 'SANTIAM PASS',
			'route-id': 'US20',
			'start-location': { 'start-lat': 44.42, 'start-long': -121.85 }
		},
		'air-temperature': 28,
		'weather-conditions': { 'weather-id': 7 },
		'road-conditions': { 'road-cond-id': 6 },
		'driving-restriction': { 'restriction-id': 'C' },
		...over
	});

	it('says no report when ODOT has none (outside winter)', () => {
		const r = odotPassReport(santiam, [], [], { now });
		expect(r.status).toBe('off-season');
		expect(r.label).toBe('No report yet');
	});

	it('reads chains, road, weather and temperature from the crew report', () => {
		const r = odotPassReport(santiam, [rw()], [], { now });
		expect(r.status).toBe('chains');
		expect(r.road).toBe('Packed snow');
		expect(r.weather).toBe('Snow flurries');
		expect(r.tempF).toBe(28);
		expect(r.restrictions[0].direction).toBe('Santiam Pass');
	});

	it('reads "carry chains" as traction, and no restriction as open', () => {
		expect(
			odotPassReport(santiam, [rw({ 'driving-restriction': { 'restriction-id': 'A' } })], [], {
				now
			}).status
		).toBe('traction');
		expect(
			odotPassReport(santiam, [rw({ 'driving-restriction': { 'restriction-id': '0' } })], [], {
				now
			}).status
		).toBe('open');
	});

	it('ignores other highways, far-away and expired reports', () => {
		expect(
			odotPassReport(santiam, [rw({ location: { ...rw().location, 'route-id': 'OR22' } })], [], {
				now
			}).status
		).toBe('off-season');
		expect(
			odotPassReport(
				santiam,
				[
					rw({
						location: {
							...rw().location,
							'start-location': { 'start-lat': 45.3, 'start-long': -121.7 }
						}
					})
				],
				[],
				{ now }
			).status
		).toBe('off-season');
		expect(
			odotPassReport(santiam, [rw({ 'expiry-time': '2026-12-10T11:00:00Z' })], [], { now }).status
		).toBe('off-season');
	});

	it('is closed when ODOT lists a closure on the highway near the summit, but not for a ramp', () => {
		const closure: OdotIncident = {
			'impact-id': '4',
			headline: 'US 20 is closed at Santiam Pass due to crashes.',
			location: {
				'route-id': 'US20',
				'start-location': { 'start-lat': 44.43, 'start-long': -121.83 }
			}
		};
		const r = odotPassReport(santiam, [rw()], [closure], { now });
		expect(r.status).toBe('closed');
		expect(r.road).toMatch(/closed at Santiam Pass/);
		expect(
			odotPassReport(santiam, [], [{ ...closure, headline: 'The EB on ramp is closed' }], { now })
				.status
		).toBe('off-season');
	});
});

describe('California pass reports (Caltrans)', () => {
	const donner = {
		id: 'donner',
		lat: 39.3416,
		lon: -120.3399,
		report: { source: 'caltrans' as const, route: 'I-80', radius_km: 15 }
	};
	const now = Date.parse('2027-01-10T20:00:00Z');
	const cc = (
		status: string,
		over: Partial<CaltransChainControl['location']> = {}
	): CaltransChainControl => ({
		location: {
			locationName: 'Kingvale',
			latitude: '39.32',
			longitude: '-120.43',
			route: 'I-80',
			direction: 'West',
			...over
		},
		inService: 'true',
		statusData: {
			status,
			statusDescription: '',
			statusTimestamp: { statusDate: '2027-01-10', statusTime: '10:00:00' }
		}
	});
	const closure = (over: Partial<CaltransClosure['closure']> = {}): CaltransClosure => ({
		location: {
			begin: {
				beginLatitude: '39.30',
				beginLongitude: '-120.70',
				beginRoute: 'I-80',
				beginLocationName: 'Colfax'
			},
			end: { endLatitude: '39.33', endLongitude: '-120.20', endLocationName: 'Truckee' }
		},
		closure: {
			facility: 'Mainline',
			typeOfClosure: 'Full',
			typeOfWork: 'Spin-outs',
			closureTimestamp: {
				closureStartEpoch: String(now / 1000 - 3600),
				closureEndEpoch: String(now / 1000 + 3600)
			},
			code1097: { isCode1097: 'true' },
			code1098: { isCode1098: 'false' },
			...over
		}
	});

	it('is "no chain controls" when the checkpoints say R-0', () => {
		const r = caltransPassReport(donner, [cc('R-0')], [], { now });
		expect(r.status).toBe('open');
		expect(r.label).toBe('No chain controls');
		expect(toneOf(r.label)).toBe('open');
	});

	it('reports the strictest chain control, once per direction', () => {
		const r = caltransPassReport(
			donner,
			[cc('R-1'), cc('R-2', { locationName: 'Soda Springs' }), cc('R-2', { direction: 'East' })],
			[],
			{ now }
		);
		expect(r.status).toBe('chains');
		expect(r.restrictions[0].text).toMatch(/Four-wheel drive/);
		expect(r.restrictions.map((x) => x.direction)).toEqual([
			'Westbound at Soda Springs',
			'Eastbound at Kingvale',
			'Westbound at Kingvale'
		]);
	});

	it('is closed by a full mainline closure in effect across the summit', () => {
		const r = caltransPassReport(donner, [cc('R-2')], [closure()], { now });
		expect(r.status).toBe('closed');
		expect(r.road).toBe('Closed from Colfax to Truckee. Spin-outs');
	});

	it('ignores closures that ended, have not started, or are only a ramp', () => {
		expect(
			caltransPassReport(donner, [cc('R-0')], [closure({ code1098: { isCode1098: 'true' } })], {
				now
			}).status
		).toBe('open');
		expect(
			caltransPassReport(donner, [cc('R-0')], [closure({ code1097: { isCode1097: 'false' } })], {
				now
			}).status
		).toBe('open');
		expect(
			caltransPassReport(donner, [cc('R-0')], [closure({ facility: 'Off Ramp' })], { now }).status
		).toBe('open');
	});

	it('does not call a winter-closure road open in deep winter just because nothing is listed', () => {
		const tioga = { ...donner, id: 'tioga', winter_closure: 'Closed for the winter' };
		expect(caltransPassReport(tioga, [cc('R-0')], [], { now }).label).toBe(
			'Usually closed in winter'
		);
		expect(
			caltransPassReport(tioga, [cc('R-0')], [], { now: Date.parse('2027-07-01T12:00:00Z') }).status
		).toBe('open');
	});

	it('cleans up checkpoint names', () => {
		expect(checkpointName('Foot of Conway / 8 Mi. N of Lee Vining _ _ _ _ (17)7_ (15)34')).toBe(
			'Foot of Conway / 8 Mi. N of Lee Vining'
		);
		expect(checkpointName('RED LAKE CREEK - CARSON PASS')).toBe('Red Lake Creek - Carson Pass');
	});
});

describe('blocksRoad', () => {
	const winter = Date.UTC(2027, 0, 15);
	const summer = Date.UTC(2026, 6, 15);
	const seasonal = { winter_closure: 'Closed for the winter' };
	it('goes around closed passes', () => {
		expect(blocksRoad({}, { status: 'closed' }, summer)).toBe(true);
		expect(blocksRoad({}, { status: 'chains' }, winter)).toBe(false);
	});
	it('Chinook on Thanksgiving: usually closed by then, so a drive goes around it unless it is reported open', () => {
		const chinook = {
			winter_closure: 'Closed for the winter, usually from November until late May',
			seasonal_closure: { from: '11-01', to: '05-31' }
		};
		const thanksgiving = Date.UTC(2026, 10, 26, 18);
		expect(blocksRoad(chinook, null, thanksgiving)).toBe(true);
		expect(blocksRoad(chinook, { status: 'off-season' }, thanksgiving)).toBe(true);
		expect(blocksRoad(chinook, { status: 'open' }, thanksgiving)).toBe(false);
		expect(blocksRoad(chinook, null, Date.UTC(2027, 4, 20))).toBe(true);
		expect(blocksRoad(chinook, null, Date.UTC(2027, 5, 15))).toBe(false);
		expect(blocksRoad(chinook, null, Date.UTC(2026, 9, 20))).toBe(false);
	});
	it('reads closing days within one year too', () => {
		expect(inClosedSeason({ from: '03-01', to: '03-31' }, Date.UTC(2027, 2, 15))).toBe(true);
		expect(inClosedSeason({ from: '03-01', to: '03-31' }, Date.UTC(2027, 3, 1))).toBe(false);
	});
	it('treats a winter road with no open report as closed in winter only', () => {
		expect(blocksRoad(seasonal, null, winter)).toBe(true);
		expect(blocksRoad(seasonal, { status: 'off-season' }, winter)).toBe(true);
		expect(blocksRoad(seasonal, { status: 'open' }, winter)).toBe(false);
		expect(blocksRoad(seasonal, null, summer)).toBe(false);
	});
});

// Wordings from WSDOT's own pass reports in past winters (from the Internet Archive's copies, 2023 to 2026).
describe('classifyPass with real WSDOT winter wording', () => {
	const real = (restriction: string, road: string, dir = 'Eastbound') =>
		classifyPass(
			pass({
				RestrictionOne: restriction ? r(restriction, dir) : null,
				RestrictionTwo: restriction
					? r(restriction, dir === 'Eastbound' ? 'Westbound' : dir)
					: null,
				RoadCondition: road
			})
		);

	it('reads the restriction lines WSDOT used', () => {
		expect(
			real('Traction Tires Advised, Oversize Vehicles Prohibited.', 'Compact snow and ice.').status
		).toBe('traction');
		expect(
			real(
				'Traction Tires Required, Chains required on Vehicles over 10,000 gross vehicle weight.  Oversize Vehicles Prohibited.',
				'Snowing'
			).status
		).toBe('chains');
		// Chains only for trucks: for a car, traction tires required.
		expect(
			real(
				'Traction Tires Required, Chains required on Vehicles over 10,000 gross vehicle weight.  Oversize Vehicles Prohibited.',
				'Snowing'
			).label
		).toBe('Traction tires required');
		expect(
			real(
				'Chains required on all vehicles except all wheel drive, Oversize Vehicles Prohibited.',
				''
			).status
		).toBe('chains');
		expect(
			real(
				'Chains required on all vehicles except all wheel drive, Oversize Vehicles Prohibited.',
				''
			).label
		).toBe('Chains required');
		expect(real('Chains Required All Vehicles Including All Wheel Drive', '').status).toBe(
			'chains'
		);
		expect(real('Pass Closed', 'Due to continued hazardous weather conditions...').status).toBe(
			'closed'
		);
		expect(real('Closed for the season', '').status).toBe('closed');
	});

	it('closes a winter highway even when the note mentions reopening or a start time', () => {
		expect(
			real(
				'',
				'SR 20 North Cascades Highway between milepost 134 and 178 (Ross Dam Trailhead to Early Winters gate), is closed for the winter as of Nov. 8. Spring clearing work is typically assessed in March and the seasonal reopening date announced.'
			).status
		).toBe('closed');
		expect(
			real(
				'',
				'SR 20 the North Cascades Highway is closed for the season as of Thursday, November 30th at 6:00 p.m. The closure points are milepost 134 at Ross Dam Trailhead.'
			).status
		).toBe('closed');
	});

	it('does not close Mt. Baker Highway for the last stretch to Artist Point', () => {
		const r1 = real(
			'Traction Tires Advised, Oversize Vehicles Prohibited.',
			'Compact snow and ice in places. The final 2.7 mile section of SR 542, known as the road to Artist Point (milepost 55) is closed for the season.'
		);
		expect(r1.status).toBe('traction');
		expect(r1.notice).toBeUndefined();
	});

	it('passes on night closures and closures down the road as a notice', () => {
		const night = real(
			'Traction Tires Advised, Oversize Vehicles Prohibited.',
			'Compact snow and ice\n\nUS 2 Stevens Pass between milepost 64 and 85 (pass summit to Coles Corner) is open daily from 6 a.m. to 6 p.m. with pilot car operations. **Road closed from 6 p.m. to 6 a.m. with no eastbound through traffic.'
		);
		expect(night.status).toBe('traction');
		expect(night.notice).toBe(
			'Road closed from 6 p.m. to 6 a.m. with no eastbound through traffic.'
		);
		const gate = real(
			'No restrictions',
			'Bare and wet\n\nUS 2 is still closed at MP 85, Coles Corner, 21 miles East of the summit and no freight traffic is allowed on the Chumstick Detour.'
		);
		expect(gate.status).toBe('open');
		expect(gate.notice).toMatch(/^US 2 is still closed at MP 85/);
		// Lane closures are not the road.
		expect(
			real(
				'No restrictions',
				'Bare and dry. Motorists will experience minor delays due to lane closures.'
			).notice
		).toBeUndefined();
	});
});
