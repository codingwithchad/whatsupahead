import { classifyRestriction, type PassReport, type PassStatus, type Restriction } from './passes';

// "Do I need chains with my AWD?" Each state words its rules differently (WSDOT writes them by hand, ODOT uses
// levels A to D, Caltrans R-1 to R-3); this turns a pass's report into one plain answer for the driver's vehicle.

export type Vehicle = 'car' | 'awd' | 'tow';

export const VEHICLES: { id: Vehicle; label: string; short: string }[] = [
	{ id: 'car', label: 'Car (2WD)', short: 'car' },
	{ id: 'awd', label: 'AWD or 4WD', short: 'AWD' },
	{ id: 'tow', label: 'Towing or over 10,000 lb', short: 'rig' }
];

/** Worst first. `carry` is "nothing required, but carry chains". */
export type Need = 'closed' | 'chains' | 'tires' | 'carry' | 'ok' | 'unknown';
const ORDER: Need[] = ['closed', 'chains', 'tires', 'carry', 'ok', 'unknown'];

export interface Answer {
	need: Need;
	text: string;
}

export const NEED_TONE: Record<Need, PassStatus> = {
	closed: 'closed',
	chains: 'chains',
	tires: 'traction',
	carry: 'traction',
	ok: 'open',
	unknown: 'off-season'
};

const say: Record<Exclude<Need, 'unknown'>, string> = {
	closed: 'Closed',
	chains: 'Chains required',
	tires: 'Traction tires required',
	carry: 'Carry chains. Nothing required yet',
	ok: 'Nothing required now'
};
const answer = (need: Exclude<Need, 'unknown'>, text = say[need]): Answer => ({ need, text });

const TIRES_REQUIRED = /traction tires? (are |is )?required/i;
const CHAINS = /\bchains? (are |is )?required\b/i;

/** What one restriction line means for this vehicle. */
export function needFor(text: string, v: Vehicle): Answer {
	const t = text.trim();
	const base = classifyRestriction(t);
	if (base === 'off-season') return { need: 'unknown', text: 'No report' };
	if (base === 'closed') return answer('closed');
	if (v === 'tow' && /(towing|trailers?)[^.]{0,30}prohibited|prohibited[^.]{0,30}towing/i.test(t))
		return answer('closed', 'No towing allowed');
	if (/traction tires alone are not enough|chains? (are )?required on all vehicles\.?$/i.test(t))
		return answer('chains');

	// WSDOT: "Chains are required on all vehicles except all wheel drive."
	if (/except (all|four)[- ]wheel drive/i.test(t)) {
		if (v !== 'awd') return answer('chains');
		return TIRES_REQUIRED.test(t)
			? answer('tires', 'Traction tires required. Carry chains')
			: answer('carry', 'No chains needed for AWD. Carry them');
	}
	// Caltrans R-2: four-wheel drive with snow tires on all four wheels may go without chains.
	if (/four-wheel drive with snow tires/i.test(t))
		return v === 'awd'
			? answer('tires', 'Snow tires on all four wheels, or chains. Carry chains')
			: answer('chains');
	// Caltrans R-1: snow tires instead of chains on vehicles under 6,000 lb.
	if (/snow tires allowed/i.test(t))
		return v === 'tow' ? answer('chains') : answer('tires', 'Snow tires, or chains. Carry chains');
	// ODOT C: traction tires instead of chains under 10,000 lb and not towing.
	if (/traction tires allowed in place of chains/i.test(t))
		return v === 'tow'
			? answer('chains')
			: answer('tires', 'Traction tires, or chains. Carry chains');
	// Chains only for towing and heavy vehicles (ODOT B, WSDOT "Chains required on vehicles over 10,000 GVW").
	if (CHAINS.test(t) && /towing|10,000|gvw|oversize|commercial|trucks?/i.test(t)) {
		if (v === 'tow') return answer('chains');
		return TIRES_REQUIRED.test(t) ? answer('tires') : answer('carry');
	}
	if (CHAINS.test(t)) return answer('chains');
	if (TIRES_REQUIRED.test(t)) return answer('tires');
	// ODOT A: "Carry chains or traction tires"; WSDOT "Traction tires advised".
	if (base === 'traction' || /\bcarry chains|advised/i.test(t))
		return answer('carry', 'Carry chains. Traction tires advised');
	if (base === 'chains') return answer('chains');
	return answer('ok');
}

const AXIS: Record<string, number> = { north: 0, east: 90, south: 180, west: 270 };

/** The restrictions for the way you are going, when the report says which way each one is. */
export function forDirection(restrictions: Restriction[], heading: number | null): Restriction[] {
	if (heading === null) return restrictions;
	const angle = (r: Restriction) => {
		const m = r.direction.match(/\b(north|south|east|west)(bound)?\b/i);
		return m ? AXIS[m[1].toLowerCase()] : null;
	};
	const off = (a: number) => Math.abs(((a - heading + 540) % 360) - 180);
	const dirs = restrictions.map(angle).filter((a): a is number => a !== null);
	if (!dirs.length) return restrictions;
	const closest = Math.min(...dirs.map(off));
	if (closest >= 90) return restrictions;
	return restrictions.filter((r) => {
		const a = angle(r);
		return a === null || off(a) === closest;
	});
}

/** One answer for this vehicle on this pass, going this way (`heading` in degrees, or null for both ways). */
export function passAnswer(
	report: Pick<PassReport, 'status' | 'label' | 'restrictions'> | null,
	v: Vehicle,
	heading: number | null = null
): Answer {
	if (!report) return { need: 'unknown', text: 'No report right now. Check before you go' };
	if (report.status === 'closed') return answer('closed');
	if (report.status === 'off-season') return { need: 'unknown', text: report.label };
	const lines = forDirection(
		report.restrictions.filter((r) => r.text.trim()),
		heading
	);
	if (!lines.length)
		return report.status === 'chains'
			? answer('chains')
			: report.status === 'traction'
				? answer('carry', 'Carry chains. Traction tires advised')
				: answer('ok');
	return lines
		.map((r) => needFor(r.text, v))
		.sort((a, b) => ORDER.indexOf(a.need) - ORDER.indexOf(b.need))[0];
}

const KEY = 'vehicle';

/** The vehicle this visitor picked before, if any (kept on the device only). */
export function loadVehicle(): Vehicle | null {
	try {
		const v = localStorage.getItem(KEY);
		return VEHICLES.some((x) => x.id === v) ? (v as Vehicle) : null;
	} catch {
		return null;
	}
}

export function saveVehicle(v: Vehicle) {
	try {
		localStorage.setItem(KEY, v);
	} catch {
		// remembering is optional
	}
}
