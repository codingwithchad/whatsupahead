import { describe, expect, it } from 'vitest';
import { classifyPass, classifyRestriction, type RawPass } from './passes';

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
