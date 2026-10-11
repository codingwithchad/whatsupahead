import { classifyPass, type PassReport, type RawPass } from '../passes';
import { cached } from './cache';

const URL_ =
	'https://wsdot.wa.gov/Traffic/api/MountainPassConditions/MountainPassConditionsREST.svc/GetMountainPassConditionsAsJson';

/** The current report for every Washington pass, keyed by WSDOT's pass id. Empty if WSDOT can't be reached. */
export async function livePasses(): Promise<Map<number, PassReport>> {
	const key = process.env.WSDOT_CODE;
	if (!key) return new Map();
	try {
		const reports = await cached('passes:all', 2 * 60 * 1000, async () => {
			const res = await fetch(`${URL_}?AccessCode=${encodeURIComponent(key)}`, {
				signal: AbortSignal.timeout(8000)
			});
			if (!res.ok) throw new Error(`upstream ${res.status}`);
			return ((await res.json()) as RawPass[]).map((raw) => classifyPass(raw));
		});
		return new Map(reports.map((r) => [r.id, r]));
	} catch (err) {
		console.warn(`[passes] ${(err as Error).message}`);
		return new Map();
	}
}
