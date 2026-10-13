import type { Camera } from './types';

// Link previews (Facebook, messages, Reddit): what a shared link shows. A camera picture appears in a preview only
// when its owner allows that kind of reuse, because a preview is a copy: our server makes the preview picture, and
// the site showing the link keeps its own copy of it. Everything else gets a card with the name and no picture.
// The basis for each source is in docs/sources.md, "Link previews".

/** Sources whose pictures may appear in a preview, and the short credit printed on the picture. */
const PREVIEW_CREDIT: Record<string, string> = {
	// Public agencies that publish the pictures for the public; credited on every preview.
	// WSDOT agreed on 2026-10-13, asking for exactly this credit (and that pictures are never called live).
	WSDOT: 'Camera courtesy of WSDOT',
	// ODOT's terms ask republishers to serve their own copy (we already do) and credit the agency.
	ODOT: 'ODOT TripCheck',
	// Open data, public domain unless noted.
	Caltrans: 'Caltrans',
	// US government works.
	'National Park Service': 'National Park Service',
	USGS: 'USGS'
};

/**
 * The credit to print when this camera's picture may appear in a link preview, or null when it may not:
 * pictures from a provider (Windy's terms forbid changing or re-hosting them), live video, cameras the agency
 * passes on for someone else ("Whidbey Telecom, via WSDOT"), and every source not in the list above.
 */
export function previewCredit(
	camera: Pick<Camera, 'source' | 'attribution_text' | 'provider' | 'feed_type' | 'feed_url'>
): string | null {
	if (camera.provider || camera.feed_type !== 'image' || !camera.feed_url) return null;
	if (/\bvia\b/i.test(camera.attribution_text ?? '')) return null;
	return PREVIEW_CREDIT[camera.source] ?? null;
}

/** Each credit once, in the order the pictures appear: "Caltrans, ODOT TripCheck". */
export function credits(list: (string | null)[]): string {
	return [...new Set(list.filter(Boolean))].join(', ');
}

/**
 * The credit line under preview pictures: "Pictures: Caltrans, ODOT TripCheck". A credit that is already a
 * sentence ("Camera courtesy of WSDOT", the owner's own wording) is printed as it is.
 */
export function creditLine(list: (string | null)[], pictures: number): string {
	const all = [...new Set(list.filter((c): c is string => Boolean(c)))];
	const own = all.filter((c) => /^camera courtesy/i.test(c));
	const rest = all.filter((c) => !own.includes(c));
	return [rest.length ? `${pictures > 1 ? 'Pictures' : 'Picture'}: ${rest.join(', ')}` : '', ...own]
		.filter(Boolean)
		.join(' · ');
}

/** Who a camera is from, as a sentence: "Camera courtesy of WSDOT." or "From Caltrans." */
export function creditSentence(camera: Pick<Camera, 'source' | 'attribution_text'>): string {
	const who = camera.attribution_text ?? camera.source;
	return /^camera courtesy/i.test(who) ? `${who}.` : `From ${who}.`;
}

/** What a page tells link previews; `image` is a path on this site. */
export interface ShareMeta {
	title: string;
	description: string;
	image?: string;
	imageAlt?: string;
}

/** Previews are made again at most every 10 minutes; the slot goes in the picture's address. */
export const PREVIEW_MINUTES = 10;
export const previewSlot = (now = Date.now()) => Math.floor(now / (PREVIEW_MINUTES * 60_000));

/**
 * The address to share for a drive: where from, where to and the stops, without this person's own choices
 * (when they leave, "show all", the winter demo).
 */
export function tripShareParams(params: { get(key: string): string | null }): URLSearchParams {
	const out = new URLSearchParams();
	// A drive planned again from where you are keeps its original start (`of`): share that, never your position.
	const original = params.get('of');
	for (const [key, source] of [
		['from', original ? 'of' : 'from'],
		['fl', original ? 'ofl' : 'fl'],
		['to', 'to'],
		['tl', 'tl'],
		['via', 'via']
	]) {
		const v = params.get(source);
		if (v) out.set(key, v);
	}
	return out;
}

/** End with a full stop unless it already ends a sentence: "Terminal cameras and sailing space." */
export const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
