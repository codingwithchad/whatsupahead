import { describe, expect, it } from 'vitest';
import { breadcrumbData, jsonLd } from './seo';

describe('search engine data', () => {
	it('lists a page’s path from Home with full addresses', () => {
		const data = breadcrumbData('https://whatsupahead.com', [
			{ name: 'Mountain passes', path: '/passes' },
			{ name: 'Stevens Pass', path: '/passes/stevens' }
		]);
		expect(data.itemListElement.map((x) => [x.position, x.name, x.item])).toEqual([
			[1, 'Home', 'https://whatsupahead.com/'],
			[2, 'Mountain passes', 'https://whatsupahead.com/passes'],
			[3, 'Stevens Pass', 'https://whatsupahead.com/passes/stevens']
		]);
	});

	it('cannot be broken out of by a name', () => {
		const tag = jsonLd({ name: '</script><script>alert(1)</script>' });
		expect(tag.match(/<\/script>/g)).toHaveLength(1);
	});
});
