import type { RequestHandler } from './$types';

// Served by the app (not a static file) so the sitemap line names whatever address the app runs at.
const RULES = `# Drive pages work out a route each time they load (a paid map service), and every pair of places is a new
# page, so search engines are asked to skip them. Link previews (Facebook, messages) may still read them.
User-agent: facebookexternalhit
User-agent: Facebot
User-agent: Twitterbot
User-agent: Slackbot
User-agent: Discordbot
User-agent: LinkedInBot
User-agent: WhatsApp
User-agent: TelegramBot
Disallow:

User-agent: *
Disallow: /trip
Disallow: /api/
Disallow: /stats`;

export const GET: RequestHandler = ({ url }) =>
	new Response(`${RULES}\n\nSitemap: ${url.origin}/sitemap.xml\n`, {
		headers: { 'content-type': 'text/plain', 'cache-control': 'public, max-age=3600' }
	});
