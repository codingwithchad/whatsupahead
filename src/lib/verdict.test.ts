import { describe, expect, it } from 'vitest';
import { driveVerdict, passVerdict, type DriveInput } from './verdict';
import type { PassReport } from './passes';
import type { RoadWarnings } from './roadAhead';
import type { StopWeather } from './routeWeather';

const report = (
	status: PassReport['status'],
	label: string,
	over: Partial<PassReport> = {}
): PassReport => ({
	id: 1,
	status,
	label,
	restrictions: [],
	road: '',
	weather: '',
	tempF: null,
	advisory: false,
	updated: null,
	...over
});
const warnings = (over: Partial<RoadWarnings> = {}): RoadWarnings => ({
	closures: [],
	chainControls: [],
	alerts: [],
	surface: [],
	unchecked: [],
	...over
});
const stop = (over: Partial<StopWeather> = {}): StopWeather => ({
	kind: 'pass',
	label: 'Stevens Pass',
	lat: 47.7,
	lon: -121.1,
	along: 80,
	minutesIn: 90,
	phrase: 'Cloudy',
	tempF: 38,
	precip: null,
	windMph: 5,
	gustMph: 10,
	hazard: 0,
	hazards: [],
	...over
});
const drive = (over: Partial<DriveInput> = {}): DriveInput => ({
	avoided: [],
	blocked: [],
	passes: [{ name: 'Stevens Pass', report: report('open', 'Open'), heading: 90 }],
	warnings: warnings(),
	weather: [stop()],
	vehicle: null,
	clock: () => '7:10 PM',
	...over
});

describe('driveVerdict', () => {
	it('says go when nothing is required and nothing is wrong', () => {
		const v = driveVerdict(drive());
		expect(v.level).toBe('go');
		expect(v.title).toBe('Looks good');
		expect(v.facts.map((f) => f.text)).toContain('38°F cloudy at Stevens Pass 7:10 PM');
	});

	it('answers for your vehicle', () => {
		const chains = report('chains', 'Chains required', {
			restrictions: [
				{
					direction: 'Eastbound',
					text: 'Chains are required on all vehicles except all wheel drive.'
				}
			]
		});
		const passes = [{ name: 'Stevens Pass', report: chains, heading: 90 }];
		expect(driveVerdict(drive({ passes, vehicle: 'car' })).level).toBe('ready');
		const awd = driveVerdict(drive({ passes, vehicle: 'awd' }));
		expect(awd.level).toBe('ready');
		expect(awd.facts[0].text).toBe('Stevens Pass: AWD with traction tires: no chains. Carry them');
	});

	it('says stop for a closed pass with no way around, or a closed road', () => {
		expect(driveVerdict(drive({ blocked: ['Stevens Pass'] })).level).toBe('stop');
		const closure = {
			source: 'WSDOT' as const,
			headline: 'US 2 is closed at milepost 60',
			start: { lat: 47, lon: -121 },
			end: { lat: 47, lon: -121 },
			updated: null,
			link: '',
			along: 60
		};
		expect(driveVerdict(drive({ warnings: warnings({ closures: [closure] }) })).level).toBe('stop');
	});

	it('says go prepared for ice, freezing pavement and a rerouted drive', () => {
		const icy = driveVerdict(drive({ weather: [stop({ hazard: 2, hazards: ['Ice possible'] })] }));
		expect(icy.level).toBe('ready');
		expect(icy.sentence).toBe('Ice possible expected at Stevens Pass around 7:10 PM.');
		const surface = [
			{
				name: 'Denny Creek on I-90 at mp 50.44',
				lat: 47,
				lon: -121,
				surfaceF: 31,
				airF: 36,
				wet: true,
				at: 0,
				along: 50
			}
		];
		const cold = driveVerdict(drive({ warnings: warnings({ surface }) }));
		expect(cold.level).toBe('ready');
		expect(cold.sentence).toContain('near Denny Creek');
		const avoided = [{ closed: 'Stevens Pass', instead: 'Snoqualmie Pass', extraMinutes: 40 }];
		expect(driveVerdict(drive({ avoided })).level).toBe('ready');
	});

	it('says which passes have no report yet', () => {
		const offSeason = [
			{ name: 'Stevens Pass', report: report('off-season', 'No report yet'), heading: 90 }
		];
		const v = driveVerdict(drive({ passes: offSeason }));
		expect(v.sentence).toBe(
			'No closures, chain rules or warnings on the way. Stevens Pass has no official report yet.'
		);
		expect(v.facts[0]).toMatchObject({ text: 'Stevens Pass: no report yet', tone: 'unknown' });
	});

	it('never says all clear when it knows nothing', () => {
		const offSeason = [
			{ name: 'Stevens Pass', report: report('off-season', 'No report yet'), heading: 90 }
		];
		expect(driveVerdict(drive({ passes: offSeason, warnings: null })).level).toBe('unknown');
		expect(
			driveVerdict(drive({ warnings: warnings({ unchecked: ['WSDOT closures'] }) })).level
		).toBe('unknown');
	});
});

describe('passVerdict', () => {
	it('puts the report in one line', () => {
		const v = passVerdict({
			name: 'Snoqualmie Pass',
			report: report('traction', 'Traction tires advised', { tempF: 31, weather: 'Snowing' })
		});
		expect(v.level).toBe('ready');
		expect(v.sentence).toBe('Snoqualmie Pass right now: traction tires advised, 31°F, snowing.');
		expect(passVerdict({ name: 'X', report: report('closed', 'Closed') }).title).toBe('Closed');
		expect(passVerdict({ name: 'X', report: null }).level).toBe('unknown');
	});
});

describe('driveVerdict weather pick', () => {
	it('shows the highest pass when the weather is calm, not the first one on the way', () => {
		const v = driveVerdict({
			avoided: [],
			blocked: [],
			passes: [],
			warnings: warnings(),
			weather: [
				stop({ label: 'Manastash Ridge', elevation_ft: 2672, along: 20, tempF: 41 }),
				stop({ label: 'Snoqualmie Pass', elevation_ft: 3022, along: 90, tempF: 33 })
			],
			vehicle: null
		});
		expect(v.facts.some((f) => f.text.includes('Snoqualmie Pass'))).toBe(true);
		expect(v.facts.some((f) => f.text.includes('Manastash'))).toBe(false);
	});
});
