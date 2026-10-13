import type { PassReport, PassStatus } from './passes';

// The home page's "Right now" line: which passes are closed or need chains or traction tires at this moment,
// worst first, so a storm shows before anyone searches. Nothing when every pass is open or has no report.

export interface RightNowLine {
	status: Extract<PassStatus, 'closed' | 'chains' | 'traction'>;
	label: string;
	passes: { id: string; name: string }[];
	/** How many more passes have this status than are named. */
	more: number;
}

const LINES: { status: RightNowLine['status']; label: string }[] = [
	{ status: 'closed', label: 'Closed' },
	{ status: 'chains', label: 'Chains' },
	{ status: 'traction', label: 'Traction tires' }
];

export function rightNow(
	passes: { id: string; name: string; winter_closure?: string }[],
	reports: Map<string, PassReport>,
	named = 4
): RightNowLine[] {
	return LINES.map(({ status, label }) => {
		// A road shut for the winter (Tioga, Sonora) is closed all season: news only when it isn't.
		const list = passes.filter(
			(p) => reports.get(p.id)?.status === status && !(status === 'closed' && p.winter_closure)
		);
		return {
			status,
			label,
			passes: list.slice(0, named).map((p) => ({ id: p.id, name: p.name })),
			more: Math.max(0, list.length - named)
		};
	}).filter((l) => l.passes.length);
}
