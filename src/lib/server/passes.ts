import {
	caltransPassReport,
	classifyPass,
	odotPassReport,
	toCheckpoint,
	type Checkpoint,
	type CaltransChainControl,
	type CaltransClosure,
	type OdotIncident,
	type OdotRwReport,
	type PassReport,
	type RawPass
} from '../passes';
import {
	idahoPassReport,
	type IdahoEvent,
	type IdahoRoadReport,
	type IdahoStation
} from '../idaho';
import type { PassInfo } from '../types';
import { cachedStale } from './cache';
import { getCatalog } from './catalog';
import { allow } from './rateLimit';

const URL_ =
	'https://wsdot.wa.gov/Traffic/api/MountainPassConditions/MountainPassConditionsREST.svc/GetMountainPassConditionsAsJson';
const ODOT = 'https://api.odot.state.or.us/tripcheck';
const CALTRANS = 'https://cwwp2.dot.ca.gov/data';
const IDAHO = 'https://511.idaho.gov/api';

/** The current report for every Washington pass, keyed by WSDOT's pass id. Empty if WSDOT can't be reached. */
export async function livePasses(): Promise<Map<number, PassReport>> {
	const key = process.env.WSDOT_CODE;
	if (!key) return new Map();
	try {
		// Like the other states: the last good reports at once while a fresh copy loads, so a slow WSDOT on a
		// storm day never holds up a page (each report says how old it is).
		const reports = await cachedStale('passes:all', 2 * 60 * 1000, async () => {
			const res = await fetch(`${URL_}?AccessCode=${encodeURIComponent(key)}`, {
				signal: AbortSignal.timeout(8000)
			});
			if (!res.ok) throw new Error(`upstream ${res.status}`);
			return ((await res.json()) as RawPass[]).map((raw) => classifyPass(raw));
		});
		return new Map(reports.map((r) => [r.id as number, r]));
	} catch (err) {
		console.warn(`[passes] ${(err as Error).message}`);
		return new Map();
	}
}

async function json<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
	const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
	if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
	return (await res.json()) as T;
}

/** ODOT's crew road reports and incidents (closures), or null when ODOT can't be reached. */
export async function odotFeeds(): Promise<{
	reports: OdotRwReport[];
	incidents: OdotIncident[];
} | null> {
	const key = process.env.ORDOT_CODE_PRIMARY;
	if (!key) return null;
	const headers = { 'Ocp-Apim-Subscription-Key': key };
	try {
		return await cachedStale('passes:odot', 2 * 60 * 1000, async () => {
			const [rw, inc] = await Promise.all([
				json<{ 'road-weather-reports'?: OdotRwReport[] }>(`${ODOT}/RW/Reports`, headers),
				json<{ incidents?: OdotIncident[] }>(`${ODOT}/Incidents`, headers)
			]);
			return { reports: rw['road-weather-reports'] ?? [], incidents: inc.incidents ?? [] };
		});
	} catch (err) {
		console.warn(`[passes] odot: ${(err as Error).message}`);
		return null;
	}
}

let idahoFailedAt = 0;

/**
 * Idaho 511's road reports, traffic events and road weather stations, or null when Idaho can't be reached.
 * Idaho 511 allows ten calls a minute for our key; this makes three every five minutes, whoever asks.
 */
export async function idahoFeeds(): Promise<{
	roads: IdahoRoadReport[];
	events: IdahoEvent[];
	stations: IdahoStation[];
} | null> {
	const key = process.env.ID_511_DOT_API_KEY;
	if (!key) return null;
	const get = <T>(path: string) => {
		if (!allow('upstream:idaho511', 8)) throw new Error('Idaho 511 limit');
		return json<T>(`${IDAHO}/${path}?format=json&key=${encodeURIComponent(key)}`);
	};
	try {
		return await cachedStale('passes:idaho', 5 * 60 * 1000, async () => {
			// After a failure (a bad key, Idaho down), wait before asking again rather than on every page.
			if (Date.now() - idahoFailedAt < 5 * 60 * 1000) throw new Error('waiting after a failure');
			try {
				const [roads, events, stations] = await Promise.all([
					get<IdahoRoadReport[]>('v3/get/winterroads'),
					get<IdahoEvent[]>('v2/get/event'),
					get<IdahoStation[]>('v2/get/weatherstations')
				]);
				return { roads, events, stations };
			} catch (err) {
				idahoFailedAt = Date.now();
				throw err;
			}
		});
	} catch (err) {
		// Never the address: it carries the key.
		console.warn(`[passes] idaho: ${(err as Error).message.replace(/key=[^&\s]+/g, 'key=…')}`);
		return null;
	}
}

/** Caltrans chain controls and lane closures for the districts our passes are in, or null if unreachable. */
async function caltransFeeds(
	districts: number[],
	closureDistricts: number[]
): Promise<{ controls: CaltransChainControl[]; closures: CaltransClosure[] } | null> {
	if (!districts.length) return null;
	const file = (kind: 'cc' | 'lcs', d: number) =>
		`${CALTRANS}/d${d}/${kind}/${kind}StatusD${String(d).padStart(2, '0')}.json`;
	try {
		const [controls, closures] = await Promise.all([
			cachedStale(`passes:caltrans-cc:${districts.join(',')}`, 5 * 60 * 1000, async () =>
				(
					await Promise.all(
						districts.map((d) => json<{ data: { cc: CaltransChainControl }[] }>(file('cc', d)))
					)
				).flatMap((j) => j.data.map((x) => x.cc))
			),
			// The closure lists are several megabytes: fetch them less often, and only where asked.
			cachedStale(`passes:caltrans-lcs:${closureDistricts.join(',')}`, 10 * 60 * 1000, async () =>
				(
					await Promise.all(
						closureDistricts.map((d) => json<{ data: { lcs: CaltransClosure }[] }>(file('lcs', d)))
					)
				)
					.flatMap((j) => j.data.map((x) => x.lcs))
					// Keep only full road closures that haven't ended: a few out of thousands of lane closures.
					.filter(
						(c) =>
							c.closure.typeOfClosure === 'Full' &&
							/^(Mainline|Conventional Hwy)$/.test(c.closure.facility ?? '') &&
							c.closure.code1098?.isCode1098 !== 'true'
					)
			)
		]);
		return { controls, closures };
	} catch (err) {
		console.warn(`[passes] caltrans: ${(err as Error).message}`);
		return null;
	}
}

// Every Caltrans district that has chain-control checkpoints (4, 5 and 12 have none).
const CHECKPOINT_DISTRICTS = [1, 2, 3, 6, 7, 8, 9, 10, 11];

/** Every Caltrans chain-control checkpoint and its level now, or null if Caltrans can't be reached. */
export async function caltransCheckpoints(): Promise<Checkpoint[] | null> {
	try {
		return await cachedStale('passes:caltrans-checkpoints', 5 * 60 * 1000, async () => [
			...(
				await Promise.all(
					CHECKPOINT_DISTRICTS.map((d) =>
						json<{ data: { cc: CaltransChainControl }[] }>(
							`${CALTRANS}/d${d}/cc/ccStatusD${String(d).padStart(2, '0')}.json`
						)
					)
				)
			)
				.flatMap((j) => j.data.map((x) => toCheckpoint(x.cc)))
				.filter((c): c is Checkpoint => c !== null)
				// Caltrans lists some checkpoints up to four times (one per lane or kind of vehicle): keep the strictest.
				.reduce((seen, c) => {
					const key = `${c.name}|${c.direction}|${c.lat}|${c.lon}`;
					const had = seen.get(key);
					if (!had || c.level > had.level) seen.set(key, c);
					return seen;
				}, new Map<string, Checkpoint>())
				.values()
		]);
	} catch (err) {
		console.warn(`[passes] caltrans checkpoints: ${(err as Error).message}`);
		return null;
	}
}

/** The Caltrans districts these passes need chain controls from, and the ones to read closures from. */
function caltransDistricts(passes: PassInfo[]) {
	const caltransPasses = passes.flatMap((p) => (p.report?.source === 'caltrans' ? [p.report] : []));
	const unique = (lists: number[][]) => [...new Set(lists.flat())].sort((a, b) => a - b);
	return {
		districts: unique(caltransPasses.map((r) => r.districts ?? [])),
		closureDistricts: unique(
			caltransPasses.filter((r) => r.closures !== false).map((r) => r.districts ?? [])
		)
	};
}

/** Caltrans full closures in the mountain districts we read for passes, or null if unreachable. */
export async function caltransClosures(): Promise<CaltransClosure[] | null> {
	const { districts, closureDistricts } = caltransDistricts(getCatalog().passes);
	return (await caltransFeeds(districts, closureDistricts))?.closures ?? null;
}

/**
 * The current report for every pass in data/passes, keyed by our pass id. A pass is missing when its state's
 * feed can't be reached (which is not the same as "no report": that is a report saying so).
 */
export async function allPassReports(
	passes: PassInfo[] = getCatalog().passes
): Promise<Map<string, PassReport>> {
	const { districts, closureDistricts } = caltransDistricts(passes);
	const [wsdot, odot, caltrans, idaho] = await Promise.all([
		livePasses(),
		passes.some((p) => p.report?.source === 'odot') ? odotFeeds() : null,
		caltransFeeds(districts, closureDistricts),
		passes.some((p) => p.report?.source === 'itd') ? idahoFeeds() : null
	]);
	const out = new Map<string, PassReport>();
	for (const p of passes) {
		const r = p.report;
		if (p.pass_id !== undefined) {
			const w = wsdot.get(p.pass_id);
			if (w) out.set(p.id, w);
		} else if (r?.source === 'odot' && odot)
			out.set(p.id, odotPassReport({ ...p, report: r }, odot.reports, odot.incidents));
		else if (r?.source === 'caltrans' && caltrans)
			out.set(p.id, caltransPassReport({ ...p, report: r }, caltrans.controls, caltrans.closures));
		else if (r?.source === 'itd' && idaho)
			out.set(
				p.id,
				idahoPassReport({ ...p, report: r }, idaho.roads, idaho.events, idaho.stations)
			);
	}
	return out;
}
