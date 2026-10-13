import { getCatalog } from '../../lib/server/catalog';
import { cacheBytes } from '../../lib/server/cache';
import { healthReport } from '../../lib/server/health';

/**
 * Used by the host to check the app is up and the data loaded, and by the daily health check
 * (.github/workflows/health.yml) to see whether each outside source still answers. Always 200 while the app
 * itself works: a provider outage must not make the host restart the app.
 */
export const GET = ({ request }: { request: Request }) => {
	const { cameras, weather, places } = getCatalog();
	return new Response(
		JSON.stringify({
			ok: true,
			cameras: cameras.length,
			weather: weather.length,
			places: places.length,
			// Which build is running, to confirm a deploy landed (not just that something answers).
			version: __BUILD__,
			// How many addresses the proxies in front of the app put in X-Forwarded-For (never the addresses
			// themselves). Rate limits trust that many entries from the right; see TRUSTED_PROXIES.
			forwarded_hops: (request.headers.get('x-forwarded-for') ?? '')
				.split(',')
				.filter((s) => s.trim()).length,
			// The form of the entries with every number blanked ("n.n.n.n:n"), to spot a host adding ports.
			forwarded_shape: (request.headers.get('x-forwarded-for') ?? '').replace(/[0-9a-f]+/gi, 'n'),
			// Whether this request came through Cloudflare (it adds CF-Connecting-IP), to confirm the proxy is on.
			cloudflare: request.headers.has('cf-connecting-ip'),
			cached_picture_mb: Math.round(cacheBytes() / 1048576),
			// Whether each key is set (never the key itself). Without them some cameras and reports show as offline.
			keys: {
				windy: Boolean(process.env.WINDY_API_KEY),
				wsdot: Boolean(process.env.WSDOT_CODE),
				github: Boolean(process.env.GITHUB_ISSUES_TOKEN),
				azure_maps: Boolean(process.env.AZURE_MAPS_KEY)
			},
			...healthReport()
		}),
		{
			headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
		}
	);
};
