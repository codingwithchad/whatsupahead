import { getCatalog } from '../../lib/server/catalog';
import type { RequestHandler } from './$types';

// The pages search engines should know about: the main pages, every pass, every place and every list.
// Drive pages are left out (robots.txt keeps search engines off them), and so are single cameras.
const escape = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: RequestHandler = ({ url }) => {
	const { passes, places, collections } = getCatalog();
	const passPlaces = new Set(passes.map((p) => p.place));
	const paths = [
		'/',
		'/passes',
		'/tires',
		'/places',
		'/about',
		...passes.map((p) => `/passes/${encodeURIComponent(p.id)}`),
		...places
			.filter((p) => !passPlaces.has(p.id))
			.map((p) => `/search?place=${encodeURIComponent(p.id)}`),
		...collections.map((c) => `/collections/${encodeURIComponent(c.id)}`)
	];
	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `<url><loc>${escape(url.origin + p)}</loc></url>`).join('\n')}
</urlset>
`;
	return new Response(body, {
		headers: { 'content-type': 'application/xml', 'cache-control': 'public, max-age=3600' }
	});
};
