import { APP_NAME } from './brand';

// What search engines read besides the page itself (schema.org, as JSON-LD): the site's name, so results say
// "What's Up Ahead" rather than the address, and a page's place in the site ("Home › Mountain passes › Stevens
// Pass"), which Google shows in place of an address like /search?place=mukilteo.

/** One step of a page's path through the site; `path` starts with a slash. */
export interface Crumb {
	name: string;
	path: string;
}

export function websiteData(origin: string) {
	return {
		'@context': 'https://schema.org',
		'@type': 'WebSite',
		name: APP_NAME,
		alternateName: 'whatsupahead.com',
		url: `${origin}/`
	};
}

export function breadcrumbData(origin: string, crumbs: Crumb[]) {
	return {
		'@context': 'https://schema.org',
		'@type': 'BreadcrumbList',
		itemListElement: [{ name: 'Home', path: '/' }, ...crumbs].map((c, i) => ({
			'@type': 'ListItem',
			position: i + 1,
			name: c.name,
			item: `${origin}${c.path}`
		}))
	};
}

/** A JSON-LD script tag. "<" is escaped so a name can never close the tag early. */
export const jsonLd = (data: unknown) =>
	`<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
