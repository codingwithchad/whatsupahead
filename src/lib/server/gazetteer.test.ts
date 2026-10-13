import { describe, expect, it } from 'vitest';
import { lookupTown, suggestTowns } from './gazetteer';

describe('lookupTown', () => {
	it('finds towns with or without the state', () => {
		for (const q of ['Snohomish', 'snohomish, wa', 'Snohomish, Washington', 'City of Snohomish']) {
			const p = lookupTown(q);
			expect(p?.label, q).toBe('Snohomish, WA');
			expect(p?.lat).toBeGreaterThan(47.8);
			expect(p?.lat).toBeLessThan(48.0);
		}
	});

	it('finds Oregon towns, and picks the state that was asked for', () => {
		expect(lookupTown('Bend, OR')?.label).toBe('Bend, OR');
		expect(lookupTown('Hood River')?.label).toBe('Hood River, OR');
		expect(lookupTown('Salem, Oregon')?.label).toBe('Salem, OR');
		expect(lookupTown('Portland')?.lat).toBeLessThan(46);
		expect(lookupTown('Mammoth Lakes')?.label).toBe('Mammoth Lakes, CA');
		expect(lookupTown('Redding, California')?.label).toBe('Redding, CA');
	});

	it('finds ZIP codes and names the nearest town', () => {
		expect(lookupTown('98290')?.label).toBe('98290, Snohomish, WA');
		expect(lookupTown('98101')?.label).toBe('98101, Seattle, WA');
		expect(lookupTown('97028')?.label).toMatch(/, OR$/);
		expect(lookupTown('90210')?.label).toBe('90210, Beverly Hills, CA');
	});

	it('leaves other states and unknown text to the online search', () => {
		expect(lookupTown('Reno, Nevada')).toBeNull();
		expect(lookupTown('89501')).toBeNull();
		expect(lookupTown('Stevens Pass')).toBeNull();
		expect(lookupTown('1600 Pennsylvania Ave')).toBeNull();
	});

	it('suggests towns from every region as you type', () => {
		expect(suggestTowns('Hood R').map((t) => `${t.label}, ${t.sub}`)).toContain('Hood River, OR');
		expect(lookupTown('Boise, Idaho')).not.toBeNull();
		expect(lookupTown('83702')).not.toBeNull();
	});
});
