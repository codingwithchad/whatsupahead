#!/usr/bin/env node
// Tell Bing (and the other IndexNow search engines: Yandex, Seznam, Naver) about every page in the sitemap, so
// new and changed pages show up in their results, and in the AI answers built on Bing, without waiting for a
// crawl. Google doesn't take IndexNow; it reads the sitemap through Search Console.
//
//   node scripts/indexnow.mjs [https://whatsupahead.com]
//
// The key is not a secret: IndexNow checks that the site serves it at /<key>.txt (static/<key>.txt), the
// default place, so the request doesn't name it (naming it got 403 answers).
import { readdirSync } from 'node:fs';

const site = (process.argv[2] ?? 'https://whatsupahead.com').replace(/\/$/, '');
const keyFile = readdirSync(new URL('../static/', import.meta.url)).find((f) =>
	/^[0-9a-f]{32}\.txt$/.test(f)
);
if (!keyFile) throw new Error('no IndexNow key file in static/');
const key = keyFile.replace('.txt', '');

const sitemap = await (await fetch(`${site}/sitemap.xml`)).text();
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
if (!urls.length) throw new Error('the sitemap lists no pages');

const res = await fetch('https://api.indexnow.org/indexnow', {
	method: 'POST',
	headers: { 'content-type': 'application/json; charset=utf-8' },
	body: JSON.stringify({
		host: new URL(site).host,
		key,
		urlList: urls
	})
});
console.log(`IndexNow: ${urls.length} pages, answered ${res.status} ${res.statusText}`);
if (res.status >= 400) process.exit(1);
