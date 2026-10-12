import { describe, expect, it } from 'vitest';
import {
	addDays,
	localDay,
	mergeHistory,
	pruneHistory,
	recordReport,
	seasonStart,
	seasonSummary,
	type PassHistory
} from './passHistory';

describe('recordReport', () => {
	it('keeps the worst report of each day', () => {
		const h: PassHistory = {};
		expect(recordReport(h, 'snoqualmie', '2026-12-03', 'open')).toBe(true);
		expect(recordReport(h, 'snoqualmie', '2026-12-03', 'chains')).toBe(true);
		expect(recordReport(h, 'snoqualmie', '2026-12-03', 'traction')).toBe(false);
		expect(h.snoqualmie['2026-12-03']).toBe('chains');
	});
});

describe('mergeHistory and pruneHistory', () => {
	it('combines two copies day by day', () => {
		const a: PassHistory = { s: { '2026-12-01': 'open', '2026-12-02': 'chains' } };
		const b: PassHistory = { s: { '2026-12-01': 'closed' }, t: { '2026-12-01': 'none' } };
		expect(mergeHistory(a, b)).toEqual({
			s: { '2026-12-01': 'closed', '2026-12-02': 'chains' },
			t: { '2026-12-01': 'none' }
		});
		expect(a.s['2026-12-01']).toBe('open');
	});
	it('drops old days', () => {
		const h: PassHistory = { s: { '2024-01-01': 'chains', '2026-12-01': 'open' } };
		expect(pruneHistory(h, '2026-12-02')).toEqual({ s: { '2026-12-01': 'open' } });
	});
});

describe('days and seasons', () => {
	it('reads the local date', () => {
		// 2 AM UTC on Dec 4 is still Dec 3 in Seattle.
		expect(localDay(Date.UTC(2026, 11, 4, 2), 'America/Los_Angeles')).toBe('2026-12-03');
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
	});
	it('starts a season in July', () => {
		expect(seasonStart('2027-02-10')).toBe('2026-07-01');
		expect(seasonStart('2026-10-12')).toBe('2026-07-01');
	});
});

describe('seasonSummary', () => {
	it('counts this season and lists the last days', () => {
		const days = {
			'2026-05-01': 'chains' as const,
			'2026-10-12': 'none' as const,
			'2026-12-01': 'chains' as const,
			'2026-12-02': 'closed' as const,
			'2026-12-03': 'chains' as const,
			'2026-12-04': 'traction' as const
		};
		const s = seasonSummary(days, '2026-12-05', 5)!;
		expect(s).toMatchObject({
			since: '2026-10-12',
			reported: 4,
			chains: 2,
			closed: 1,
			traction: 1,
			lastChains: '2026-12-03',
			lastClosed: '2026-12-02'
		});
		expect(s.recent.map((d) => d.status)).toEqual(['chains', 'closed', 'chains', 'traction', null]);
	});
	it('is empty before the first day of the season', () => {
		expect(seasonSummary(undefined, '2026-12-05')).toBeNull();
		expect(seasonSummary({ '2026-05-01': 'chains' }, '2026-12-05')).toBeNull();
	});
});
