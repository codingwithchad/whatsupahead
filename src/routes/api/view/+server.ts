import { visitorAddress } from '../../../lib/server/rateLimit';
import { isPerson, NO_COUNT_COOKIE, recordView, viewOf } from '../../../lib/server/stats';
import type { RequestHandler } from './$types';

/**
 * A page view, sent by the page once it has run in a browser (sendBeacon), so programs that only download pages
 * are not counted. Only the page's short name, the place it is about and where it came from are kept.
 */
export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	let body: { path?: unknown; referrer?: unknown; first?: unknown } = {};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		// not JSON: ignore
	}
	const userAgent = request.headers.get('user-agent') ?? '';
	const view =
		typeof body.path === 'string'
			? viewOf(
					body.path.slice(0, 2000),
					typeof body.referrer === 'string' ? body.referrer.slice(0, 2000) : null,
					body.first === true
				)
			: null;
	if (view && isPerson(userAgent) && !cookies.get(NO_COUNT_COOKIE))
		recordView({ address: visitorAddress(request, getClientAddress), userAgent, ...view });
	return new Response(null, { status: 204 });
};
