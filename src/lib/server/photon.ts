import { cached } from './cache';
import { allow, visitorAllowed } from './rateLimit';
import { COVERAGE, REGIONS } from '../regions';

// Photon (by Komoot) is a free search service built on OpenStreetMap data that forgives typos and works as
// you type. It is used as the main place search, with Nominatim and Open-Meteo as backups.
const USER_AGENT = 'WhatsUpAhead (https://github.com/codingwithchad/whatsupahead)';
const URL_ = 'https://photon.komoot.io/api/';
// Every region the app covers (west, south, east, north), with a little room around it. Keeps results here
// instead of a same-named place elsewhere.
const BBOX = [COVERAGE[0] - 0.7, COVERAGE[1] - 0.5, COVERAGE[2] + 0.5, COVERAGE[3] + 0.5].join(',');
const CENTER = {
	lat: ((COVERAGE[1] + COVERAGE[3]) / 2).toFixed(2),
	lon: ((COVERAGE[0] + COVERAGE[2]) / 2).toFixed(2)
};
const ABBR = new Map(REGIONS.map((r) => [r.name, r.abbr]));
const HOUR = 60 * 60 * 1000;

export interface Suggestion {
	label: string;
	sub: string;
	lat: number;
	lon: number;
}

interface Feature {
	geometry?: { coordinates?: [number, number] };
	properties?: {
		name?: string;
		housenumber?: string;
		street?: string;
		city?: string;
		town?: string;
		village?: string;
		district?: string;
		county?: string;
		state?: string;
		postcode?: string;
	};
}

export function toSuggestion(f: Feature): Suggestion | null {
	const p = f.properties ?? {};
	const [lon, lat] = f.geometry?.coordinates ?? [];
	if (typeof lat !== 'number' || typeof lon !== 'number') return null;
	const label = p.name ?? [p.housenumber, p.street].filter(Boolean).join(' ');
	if (!label) return null;
	const where = p.city ?? p.town ?? p.village ?? p.district ?? p.county ?? '';
	const state = (p.state && ABBR.get(p.state)) ?? p.state ?? '';
	return { label, sub: [where, state].filter(Boolean).join(', '), lat, lon };
}

export async function photonSearch(query: string, limit = 5): Promise<Suggestion[]> {
	const q = query.trim().slice(0, 120);
	if (q.length < 2) return [];
	return cached(`photon:${limit}:${q.toLowerCase().replace(/\s+/g, ' ')}`, HOUR, async () => {
		// A free shared service: cap what each visitor and the whole app send it.
		if (!visitorAllowed('photon', 40)) throw new Error('place search busy');
		if (!allow('upstream:photon', 120)) throw new Error('place search busy');
		const url = new URL(URL_);
		url.search = new URLSearchParams({
			q,
			limit: String(limit + 3),
			lang: 'en',
			lat: CENTER.lat,
			lon: CENTER.lon,
			bbox: BBOX
		}).toString();
		const res = await fetch(url, {
			headers: { 'User-Agent': USER_AGENT },
			signal: AbortSignal.timeout(6000)
		});
		if (!res.ok) throw new Error(`photon ${res.status}`);
		const body = (await res.json()) as { features?: Feature[] };
		const seen = new Set<string>();
		const out: Suggestion[] = [];
		for (const f of body.features ?? []) {
			const s = toSuggestion(f);
			if (!s) continue;
			const key = `${s.label}|${s.sub}`.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(s);
			if (out.length >= limit) break;
		}
		return out;
	});
}
