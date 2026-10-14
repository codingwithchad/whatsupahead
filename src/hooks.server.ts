import type { Handle } from '@sveltejs/kit/hooks';
import { getCatalog } from './lib/server/catalog';
import { startHistory } from './lib/server/history';
import { startHealthChecks } from './lib/server/health';
import { startPassHistory } from './lib/server/passHistory';
import { allow, tooManyRequests, visitorAddress } from './lib/server/rateLimit';
import { withVisitor } from './lib/server/visitor';
import {
	isPerson,
	NO_COUNT_COOKIE,
	pageOf,
	recordSearch,
	recordView,
	siteName,
	startStats
} from './lib/server/stats';
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
 * free host's own *.onrender.com address, or www.) forwards there, so old links and posts keep working.
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
	if (event.request.method === 'GET' && response.status === 200) countVisit(event);
	// Pictures may be kept by Cloudflare in front of the app (a shared link's preview is then made once, not for
	// every visitor), but pages never: each page view must reach the app to be counted, and pages are cheap.
	if (
		(event.isDataRequest || response.headers.get('content-type')?.startsWith('text/html')) &&
		!response.headers.has('cdn-cache-control')
	)
		response.headers.set('cdn-cache-control', 'no-store');
	for (const [name, value] of Object.entries(SECURITY_HEADERS))
		if (!response.headers.has(name)) response.headers.set(name, value);
	return response;
}

// Our own hosts (and bare addresses, which are tests, not sites) never count as "came from another site".
const OWN_HOSTS =
	/(^|\.)(whatsupahead\.com|whatsupahead\.app|onrender\.com|azurewebsites\.net|localhost)$|^[\d.]+$|^\[/;

/** Count a page view (full page loads and in-app moves, which fetch the page's data). */
function countVisit(event: Parameters<Handle>[0]['event']) {
	const page = pageOf(event.url);
	const userAgent = event.request.headers.get('user-agent') ?? '';
	if (!page || !isPerson(userAgent)) return;
	// Our own test phones and browsers, marked on /stats.
	if (event.cookies.get(NO_COUNT_COOKIE)) return;
	// A page someone opened, or moved to inside the app; not a background fetch (the offline helper refreshing
	// its saved copy of the home page, for example). Older browsers send no Sec-Fetch-Dest: count those.
	const dest = event.request.headers.get('sec-fetch-dest');
	if (!event.isDataRequest && dest && dest !== 'document') return;
	let from: string | null = null;
	let source: string | null = null;
	const referer = event.request.headers.get('referer');
	if (referer) {
		try {
			const ref = new URL(referer);
			if (OWN_HOSTS.test(ref.hostname)) from = pageOf(ref)?.page ?? null;
			else if (!event.isDataRequest) source = siteName(ref.hostname);
		} catch {
			// not a usable address
		}
	}
	// A tagged link (whatsupahead.com/?ref=fb) names where it was posted, so a post can be counted even when the
	// app it was opened in (Facebook's, Instagram's) sends no referrer. Only a short word, never anything personal.
	const tag = event.isDataRequest ? null : event.url.searchParams.get('ref');
	if (tag && /^[a-z0-9-]{1,20}$/i.test(tag)) source = `${tag.toLowerCase()} (tagged link)`;
	recordView({
		address: visitorAddress(event.request, event.getClientAddress),
		userAgent,
		page: page.page,
		place: page.place,
		from,
		source
	});
	if (event.locals.searchFound !== undefined) recordSearch(event.locals.searchFound);
}
