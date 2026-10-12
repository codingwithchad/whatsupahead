import { error, json } from '@sveltejs/kit';
import { COVERAGE } from '../../../../lib/regions';
import type { LatLon } from '../../../../lib/route';
import { liveUpdate } from '../../../../lib/server/tripLive';
import type { RequestHandler } from './$types';

// A drive page open on the dash asks here every few minutes for fresh pass reports, warnings and weather. It
// sends the route it already has, so this never asks a routing service for one.

const MAX_POINTS = 5000;
const MARGIN = 2; // degrees around the covered states, for drives that end just outside them
const inside = (lat: unknown, lon: unknown): lat is number =>
	typeof lat === 'number' &&
	typeof lon === 'number' &&
	lon >= COVERAGE[0] - MARGIN &&
	lat >= COVERAGE[1] - MARGIN &&
	lon <= COVERAGE[2] + MARGIN &&
	lat <= COVERAGE[3] + MARGIN;

function place(v: unknown): { lat: number; lon: number; label: string; featuredId?: string } {
	const p = v as { lat?: unknown; lon?: unknown; label?: unknown; featuredId?: unknown } | null;
	if (!p || !inside(p.lat, p.lon)) error(400, 'Bad place');
	return {
		lat: p.lat as number,
		lon: p.lon as number,
		label: typeof p.label === 'string' ? p.label.slice(0, 80) : '',
		featuredId: typeof p.featuredId === 'string' ? p.featuredId.slice(0, 80) : undefined
	};
}

export const POST: RequestHandler = async ({ request }) => {
	if (!request.headers.get('content-type')?.startsWith('application/json')) error(415, 'Send JSON');
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		error(400, 'Not JSON');
	}
	const route = body.route;
	if (
		!Array.isArray(route) ||
		route.length < 2 ||
		route.length > MAX_POINTS ||
		!route.every((p) => Array.isArray(p) && p.length === 2 && inside(p[0], p[1]))
	)
		error(400, 'Bad route');
	const minutes = Number(body.minutes);
	const startAt = Number(body.startAt);
	const now = Date.now();
	if (!(minutes > 0 && minutes < 3000)) error(400, 'Bad minutes');
	if (!(startAt > now - 48 * 3600_000 && startAt < now + 24 * 3600_000)) error(400, 'Bad start');
	const update = await liveUpdate({
		route: route as LatLon[],
		minutes,
		startAt,
		from: place(body.from),
		to: place(body.to),
		demo: body.demo === true
	});
	return json(update, { headers: { 'cache-control': 'no-store' } });
};
