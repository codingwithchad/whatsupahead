<script lang="ts">
	import { page } from '$app/state';
	import favicon from '../lib/assets/favicon.svg';
	import '../app.css';
	import { APP_NAME, REPO_URL, TAGLINE, WHERE } from '../lib/brand';
	import OfflineBanner from '../lib/OfflineBanner.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	// Shared links show this picture and text (Reddit, Facebook, messages).
	const image = $derived(`${page.url.origin}/og-image.png`);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<meta name="theme-color" content="#0b2540" />
	<meta name="description" content="{TAGLINE} {WHERE}" />
	<meta property="og:site_name" content={APP_NAME} />
	<meta property="og:type" content="website" />
	<meta property="og:title" content={APP_NAME} />
	<meta
		property="og:description"
		content="{TAGLINE} {WHERE} Free, no accounts, no ads. Works on any phone."
	/>
	<meta property="og:image" content={image} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<OfflineBanner />
{@render children()}

<footer class="site-footer">
	<nav aria-label="About">
		<a href="/about">About</a>
		<a href="/passes">Passes</a>
		<a href="/contribute">Add a camera</a>
		<a href="{REPO_URL}/blob/main/docs/sources.md" target="_blank" rel="noopener">Sources</a>
		<a href={REPO_URL} target="_blank" rel="noopener">Open source</a>
	</nav>
	<p>
		Independent project, not affiliated with any transportation department or agency. Check official
		sources before you travel.
	</p>
</footer>
