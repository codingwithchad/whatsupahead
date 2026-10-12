import { describe, expect, it } from 'vitest';
import { inSeason, seasonalDrives } from './seasonalDrives';
import type { Drive } from './types';

const drive = (id: string, state: string, from: string, to: string, order = 1): Drive => ({
	id,
	name: id,
	from: 'a',
	to: 'b',
	state,
	order,
	season: { from, to }
});

describe('inSeason', () => {
	it('reads plain and New Year seasons', () => {
		expect(inSeason({ from: '09-15', to: '12-31' }, '10-12')).toBe(true);
		expect(inSeason({ from: '09-15', to: '12-31' }, '01-02')).toBe(false);
		expect(inSeason({ from: '11-15', to: '01-05' }, '12-25')).toBe(true);
		expect(inSeason({ from: '11-15', to: '01-05' }, '01-03')).toBe(true);
		expect(inSeason({ from: '11-15', to: '01-05' }, '10-12')).toBe(false);
		expect(inSeason(undefined, '10-12')).toBe(true);
	});
});

describe('seasonalDrives', () => {
	it('mixes the states and leaves out what is out of season', () => {
		const list = [
			drive('wa1', 'WA', '09-15', '12-31', 1),
			drive('wa2', 'WA', '06-01', '10-31', 2),
			drive('wa-ski', 'WA', '12-01', '03-31', 3),
			drive('or1', 'OR', '10-01', '11-10'),
			drive('ca1', 'CA', '09-25', '10-31')
		];
		expect(seasonalDrives(list, '10-12').map((d) => d.id)).toEqual(['wa1', 'or1', 'ca1', 'wa2']);
		expect(seasonalDrives(list, '12-20').map((d) => d.id)).toEqual(['wa1', 'wa-ski']);
		expect(seasonalDrives(list, '05-01')).toEqual([]);
	});
});
