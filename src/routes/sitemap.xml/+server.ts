import { sitemapPages } from '../../lib/server/sitemap';
import type { RequestHandler } from './$types';

const escape = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The sitemap (see sitemapPages): every page we want found, with when a pass's report last changed. */
export const GET: RequestHandler = async ({ url }) => {
	const pages = await sitemapPages();
	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
	.map(
		(p) =>
			`<url><loc>${escape(url.origin + p.path)}</loc>${p.modified ? `<lastmod>${new Date(p.modified).toISOString()}</lastmod>` : ''}</url>`
	)
	.join('\n')}
</urlset>
`;
	return new Response(body, {
		headers: { 'content-type': 'application/xml', 'cache-control': 'public, max-age=3600' }
	});
};
