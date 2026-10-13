import { describe, expect, it } from 'vitest';
import type { PassReport, PassStatus } from './passes';
import { rightNow } from './rightNow';

const report = (status: PassStatus) => ({ status }) as PassReport;

describe('right now on the passes', () => {
	const passes = [
		{ id: 'stevens', name: 'Stevens Pass' },
		{ id: 'snoqualmie', name: 'Snoqualmie Pass' },
		{ id: 'tioga', name: 'Tioga Pass', winter_closure: 'Closed for the winter' },
		{ id: 'chinook', name: 'Chinook Pass' },
		{ id: 'white-pass', name: 'White Pass' }
	];

	it('lists closed, then chains, then traction tires, and nothing that is open', () => {
		const lines = rightNow(
			passes,
			new Map([
				['stevens', report('chains')],
				['snoqualmie', report('traction')],
				['chinook', report('closed')],
				['white-pass', report('open')]
			])
		);
		expect(lines.map((l) => [l.label, l.passes.map((p) => p.name)])).toEqual([
			['Closed', ['Chinook Pass']],
			['Chains', ['Stevens Pass']],
			['Traction tires', ['Snoqualmie Pass']]
		]);
	});

	it('leaves out roads closed for the winter, and is empty when all is clear', () => {
		expect(rightNow(passes, new Map([['tioga', report('closed')]]))).toEqual([]);
		expect(rightNow(passes, new Map([['stevens', report('open')]]))).toEqual([]);
	});

	it('names a few and counts the rest', () => {
		const all = new Map(passes.map((p) => [p.id, report('chains')]));
		const [line] = rightNow(passes, all, 2);
		expect(line.passes).toHaveLength(2);
		expect(line.more).toBe(3);
	});
});
