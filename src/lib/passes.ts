import { parseDotNetDate } from './transit';

export type PassStatus = 'closed' | 'chains' | 'traction' | 'open' | 'off-season';

export interface Restriction {
	direction: string;
	text: string;
}

/** One report as WSDOT's Mountain Pass Conditions service returns it (the fields we use). */
export interface RawPass {
	MountainPassId: number;
	MountainPassName: string;
	ElevationInFeet?: number;
	Latitude?: number;
	Longitude?: number;
	DateUpdated?: string;
	RoadCondition?: string | null;
	WeatherCondition?: string | null;
	TemperatureInFahrenheit?: number | null;
	TravelAdvisoryActive?: boolean;
	RestrictionOne?: { RestrictionText?: string | null; TravelDirection?: string | null } | null;
	RestrictionTwo?: { RestrictionText?: string | null; TravelDirection?: string | null } | null;
}

export interface PassReport {
	id: number;
	status: PassStatus;
	label: string;
	restrictions: Restriction[];
	road: string;
	weather: string;
	tempF: number | null;
	advisory: boolean;
	updated: number | null;
}

export const STATUS_LABEL: Record<PassStatus, string> = {
	closed: 'Closed',
	chains: 'Chains required',
	traction: 'Traction tires advised',
	open: 'Open',
	// WSDOT has stopped its hand-written reports for the season (usually April to November). No report is
	// not the same as open: say only what we know, and point to the cameras.
	'off-season': 'No report yet'
};

// Worst first: this is how two directions are combined.
const SEVERITY: PassStatus[] = ['closed', 'chains', 'traction', 'open', 'off-season'];

const OFF_SEASON =
	/reports? (have|has) ended|not reporting|no current information|reporting (season|period)|traditionally .{0,40}(reported|conditions)|reported (on this page )?from/i;

/** What one restriction line means. WSDOT writes these by hand, so match the common wordings. */
export function classifyRestriction(text: string): PassStatus {
	const t = text.trim();
	if (!t || /^no current information/i.test(t)) return 'off-season';
	if (/\bclosed\b/i.test(t) && !/reopen|not closed/i.test(t)) return 'closed';
	if (/chains?\b/i.test(t) && !/no chains?|chains? (are )?not (required|needed)/i.test(t))
		return 'chains';
	if (/traction|snow tires?|tire advisory|advised/i.test(t) && !/^no restrictions/i.test(t))
		return 'traction';
	if (/^no restrictions/i.test(t)) return 'open';
	return 'open';
}

// A report this old is history, not the road today (WSDOT updates live reports many times a day in season).
const STALE_MS = 3 * 24 * 60 * 60 * 1000;

export function classifyPass(raw: RawPass, now = Date.now()): PassReport {
	const restrictions = [raw.RestrictionOne, raw.RestrictionTwo]
		.filter((r): r is NonNullable<typeof r> => Boolean(r?.RestrictionText?.trim()))
		.map((r) => ({ direction: r.TravelDirection?.trim() ?? '', text: r.RestrictionText!.trim() }));
	const road = (raw.RoadCondition ?? '').replace(/\s+/g, ' ').trim();

	// Worst of the two directions.
	let status =
		restrictions
			.map((r) => classifyRestriction(r.text))
			.sort((a, b) => SEVERITY.indexOf(a) - SEVERITY.indexOf(b))[0] ?? 'off-season';

	// The road report can say the pass is closed even when the restriction lines are blank or generic.
	if (
		status !== 'closed' &&
		/\b(is|are|remains?|currently|now)\s+closed\b/i.test(road) &&
		!/reopen|re-open/i.test(road)
	)
		status = 'closed';
	// Reporting has stopped for the season: the "No restrictions" lines are not live information.
	if (status === 'open' && OFF_SEASON.test(road)) status = 'off-season';
	if (
		status === 'off-season' &&
		!OFF_SEASON.test(road) &&
		restrictions.length &&
		restrictions.every((r) => /^no restrictions/i.test(r.text))
	)
		status = 'open';

	// An old "open" or "chains" is not today's road. A closure stays shown: it is safer to send people to check.
	const updated = raw.DateUpdated ? parseDotNetDate(raw.DateUpdated) : null;
	let label = STATUS_LABEL[status];
	if (
		updated !== null &&
		now - updated > STALE_MS &&
		status !== 'closed' &&
		status !== 'off-season'
	) {
		status = 'off-season';
		label = 'No recent report';
	}

	return {
		id: raw.MountainPassId,
		status,
		label,
		restrictions,
		road,
		weather: (raw.WeatherCondition ?? '').trim(),
		tempF: raw.TemperatureInFahrenheit ?? null,
		advisory: Boolean(raw.TravelAdvisoryActive),
		updated
	};
}
