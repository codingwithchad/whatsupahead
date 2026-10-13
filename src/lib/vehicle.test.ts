import { describe, expect, it } from 'vitest';
import { forDirection, needFor, passAnswer } from './vehicle';
import type { PassReport } from './passes';

const report = (over: Partial<PassReport>): PassReport => ({
	id: 1,
	status: 'open',
	label: 'Open',
	restrictions: [],
	road: '',
	weather: '',
	tempF: null,
	advisory: false,
	updated: null,
	...over
});

describe('needFor', () => {
	it('reads WSDOT wordings for each vehicle', () => {
		const awd = 'Chains are required on all vehicles except all wheel drive.';
		expect(needFor(awd, 'car').need).toBe('chains');
		expect(needFor(awd, 'awd').need).toBe('tires');
		expect(needFor(awd, 'tow').need).toBe('chains');
		const heavy = 'Traction tires are required. Chains are required on vehicles over 10,000 GVW.';
		expect(needFor(heavy, 'car').need).toBe('tires');
		expect(needFor(heavy, 'awd').need).toBe('tires');
		expect(needFor(heavy, 'tow').need).toBe('chains');
		expect(needFor('Traction tires advised. Oversize vehicles are prohibited.', 'car').need).toBe(
			'carry'
		);
		expect(needFor('Chains required on all vehicles', 'awd').need).toBe('chains');
		expect(needFor('No restrictions', 'car').need).toBe('ok');
		expect(needFor('Pass closed for avalanche control', 'awd').need).toBe('closed');
		expect(needFor('Vehicles towing are prohibited.', 'tow').need).toBe('closed');
	});

	it('reads ODOT levels', () => {
		expect(needFor('Carry chains or traction tires', 'car').need).toBe('carry');
		expect(needFor('Chains required on vehicles towing or over 10,000 GVW', 'car').need).toBe(
			'carry'
		);
		expect(needFor('Chains required on vehicles towing or over 10,000 GVW', 'tow').need).toBe(
			'chains'
		);
		const c =
			'Chains required. Traction tires allowed in place of chains on vehicles under 10,000 GVW and not towing';
		expect(needFor(c, 'car').need).toBe('tires');
		expect(needFor(c, 'tow').need).toBe('chains');
		expect(needFor('Chains required. Traction tires alone are not enough', 'awd').need).toBe(
			'chains'
		);
	});

	it('reads Caltrans chain-control levels', () => {
		const r1 = 'Chains required. Snow tires allowed on vehicles under 6,000 lb';
		const r2 = 'Chains required. Four-wheel drive with snow tires on all four wheels allowed';
		expect(needFor(r1, 'car').need).toBe('tires');
		expect(needFor(r1, 'tow').need).toBe('chains');
		expect(needFor(r2, 'car').need).toBe('chains');
		expect(needFor(r2, 'awd').need).toBe('tires');
		expect(needFor('Chains required on all vehicles', 'awd').need).toBe('chains');
	});
});

describe('forDirection', () => {
	const both = [
		{ direction: 'Eastbound', text: 'Chains required on all vehicles' },
		{ direction: 'Westbound', text: 'Traction tires advised' }
	];
	it('keeps the way you are going', () => {
		expect(forDirection(both, 80).map((r) => r.direction)).toEqual(['Eastbound']);
		expect(forDirection(both, 265).map((r) => r.direction)).toEqual(['Westbound']);
	});
	it('keeps everything when it cannot tell', () => {
		expect(forDirection(both, null)).toHaveLength(2);
		expect(forDirection(both, 0)).toHaveLength(2);
		const named = [{ direction: 'Santiam Pass', text: 'Carry chains or traction tires' }];
		expect(forDirection(named, 90)).toEqual(named);
	});
	it('reads Caltrans checkpoint directions', () => {
		const cc = [
			{ direction: 'Eastbound at Kingvale', text: 'x' },
			{ direction: 'Westbound at Truckee', text: 'y' }
		];
		expect(forDirection(cc, 100).map((r) => r.text)).toEqual(['x']);
	});
});

describe('passAnswer', () => {
	it('takes the worst line for your direction', () => {
		const r = report({
			status: 'chains',
			restrictions: [
				{
					direction: 'Eastbound',
					text: 'Chains are required on all vehicles except all wheel drive.'
				},
				{ direction: 'Westbound', text: 'Traction tires advised.' }
			]
		});
		expect(passAnswer(r, 'awd', 90).need).toBe('tires');
		expect(passAnswer(r, 'car', 90).need).toBe('chains');
		expect(passAnswer(r, 'car', 270).need).toBe('carry');
		expect(passAnswer(r, 'car').need).toBe('chains');
	});
	it('never calls a missing or seasonal report clear', () => {
		expect(passAnswer(null, 'car').need).toBe('unknown');
		expect(passAnswer(report({ status: 'off-season', label: 'No report yet' }), 'car')).toEqual({
			need: 'unknown',
			text: 'No report yet'
		});
		expect(passAnswer(report({ status: 'closed' }), 'awd').need).toBe('closed');
	});
	it('falls back to the status when there are no lines', () => {
		expect(passAnswer(report({ status: 'traction' }), 'car').need).toBe('carry');
		expect(passAnswer(report({ status: 'open', label: 'No chain controls' }), 'car').need).toBe(
			'ok'
		);
	});
});
