import type { Handle } from '@sveltejs/kit/hooks';
import { getCatalog } from './lib/server/catalog';
import { startAutopost } from './lib/server/autopost';
import { startHistory } from './lib/server/history';
import { startHealthChecks } from './lib/server/health';
import { startPassHistory } from './lib/server/passHistory';
import { allow, tooManyRequests, visitorAddress } from './lib/server/rateLimit';
import { withVisitor } from './lib/server/visitor';
import { isPerson, NO_COUNT_COOKIE, recordSearch, startStats } from './lib/server/stats';
import { dev } from '$app/env';

// Load secrets (e.g. WSDOT_CODE) from a local .env file when present. In production, set real environment variables.
try {
	process.loadEnvFile('.env');
} catch {
	// no .env file: rely on the real environment
}

// Read all the data files when the server starts so the first visitor does not wait for them.
getCatalog();

// Start saving the pass-camera pictures that power the replay. Off in development; set HISTORY=off to disable anywhere.
if (!dev && process.env.HISTORY !== 'off') startHistory();

// Check every half hour that each outside source (and its key) still works; results are on /healthz.
if (!dev && process.env.HEALTH_CHECKS !== 'off') startHealthChecks();

// Note each pass's report every 10 minutes, for "chains required on 9 days this season" on pass pages.
if (!dev && process.env.PASS_HISTORY !== 'off') startPassHistory();

// Post the snow to the site's Facebook Page by itself (only notes what it would post until the Page's key is set).
if (!dev && process.env.AUTOPOST !== 'off') startAutopost();

// Our own visit counter (counts only, no cookies); the numbers are on /stats.
if (!dev) startStats();

// A missing key does not stop the app, but those cameras and reports show as offline, so say so loudly in the logs.
for (const [name, what] of [
	['WSDOT_CODE', 'WSDOT road reports, ferry space, border waits and weather stations'],
	['WINDY_API_KEY', 'the Windy.com cameras (resorts, Westport, Seattle sights and more)']
] as const) {
	if (!process.env[name])
		console.warn(`[config] ${name} is not set: ${what} will show as unavailable.`);
}

/**
 * The address people should use, for example "whatsupahead.com". When set, every other address (such as the
 * host's own address, or www.) forwards there, so old links and posts keep working.
 * Set it only after the domain is connected and its HTTPS certificate is ready.
 */
const CANONICAL_HOST = process.env.CANONICAL_HOST?.trim().toLowerCase();

const SECURITY_HEADERS: Record<string, string> = {
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'x-frame-options': 'SAMEORIGIN',
	'permissions-policy': 'geolocation=(self), camera=(), microphone=()',
	'strict-transport-security': 'max-age=31536000'
};

/**
 * Requests per visitor per minute. Searches and trips can call free outside services (routing, place search),
 * so they get a lower limit; pictures and small API calls come in bursts of 20 or more per page.
 * Generous on purpose: many people can share one address (a ferry's wifi, a phone carrier).
 */
const PER_MINUTE: [prefix: string, limit: number, method?: string][] = [
	['/search', 60],
	['/trip', 60],
	['/powder', 30],
	// Saving a before-and-after writes to disk (looking at one is a picture like any other).
	['/api/moments', 30, 'POST'],
	// A drive page on the dash refreshes every 5 minutes (or on "Update now"); more than this is not a person.
	['/api/trip', 12],
	['/api/', 600],
	['/img/', 600],
	// Share pictures take a moment to make; crawlers ask for one per shared link.
	['/og/', 60]
];

// The services that fetch a shared link's preview picture (Facebook, Messenger, X, Slack...) each ask from a
// few addresses for everyone sharing links at once, so on a busy day they get ten times the picture limit.
// Pretending to be one only buys more preview pictures, which are made at most once every ten minutes anyway.
const LINK_PREVIEWERS =
	/facebookexternalhit|facebot|twitterbot|slackbot|discordbot|whatsapp|linkedinbot|telegrambot|pinterest|redditbot|skypeuripreview|applebot|googlebot|bingbot/i;

export const handle: Handle = async ({ event, resolve }) => {
	const who = visitorAddress(event.request, event.getClientAddress);
	// Everything this request starts (including data the page streams in later) knows whose it is.
	return withVisitor(who, () => handleFor(who, event, resolve));
};

async function handleFor(
	who: string,
	event: Parameters<Handle>[0]['event'],
	resolve: Parameters<Handle>[0]['resolve']
): Promise<Response> {
	const rule = PER_MINUTE.find(
		([prefix, , method]) =>
			event.url.pathname.startsWith(prefix) && (!method || event.request.method === method)
	);
	if (rule) {
		const limit =
			rule[0] === '/og/' && LINK_PREVIEWERS.test(event.request.headers.get('user-agent') ?? '')
				? rule[1] * 10
				: rule[1];
		if (!allow(`${rule[0]}:${who}`, limit)) return tooManyRequests(event.request);
	}

	if (
		CANONICAL_HOST &&
		event.url.pathname !== '/healthz' &&
		['GET', 'HEAD'].includes(event.request.method)
	) {
		const host = (
			event.request.headers.get('x-forwarded-host') ??
			event.request.headers.get('host') ??
			''
		).toLowerCase();
		if (host && host !== CANONICAL_HOST && !/^(localhost|127\.|\[::1\])/.test(host)) {
			return new Response(null, {
				status: 301,
				headers: { location: `https://${CANONICAL_HOST}${event.url.pathname}${event.url.search}` }
			});
		}
	}
	const response = await resolve(event);
	if (event.request.method === 'GET' && response.status === 200) countSearch(event);
	// Pictures may be kept by Cloudflare in front of the app (a shared link's preview is then made once, not for
	// every visitor), but pages never: they carry live reports, and a page's search must reach the app to be counted.
	if (
		(event.isDataRequest || response.headers.get('content-type')?.startsWith('text/html')) &&
		!response.headers.has('cdn-cache-control')
	)
		response.headers.set('cdn-cache-control', 'no-store');
	for (const [name, value] of Object.entries(SECURITY_HEADERS))
		if (!response.headers.has(name)) response.headers.set(name, value);
	return response;
}

/**
 * Page views are counted by the page itself once it runs in a browser (/api/view), so programs that only download
 * pages (scrapers with a browser's name) are not counted. Searches are still counted here, where the answer is known.
 */
function countSearch(event: Parameters<Handle>[0]['event']) {
	if (event.locals.searchFound === undefined) return;
	if (!isPerson(event.request.headers.get('user-agent') ?? '')) return;
	if (event.cookies.get(NO_COUNT_COOKIE)) return;
	recordSearch(event.locals.searchFound);
}
