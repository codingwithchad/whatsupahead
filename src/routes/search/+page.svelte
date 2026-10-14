<script lang="ts">
	import { APP_NAME } from '../../lib/brand';
	import PlaceBody from '../../lib/PlaceBody.svelte';
	import SkiSnowLine from '../../lib/SkiSnowLine.svelte';
	import SearchBox from '../../lib/SearchBox.svelte';
	import ShareButton from '../../lib/ShareButton.svelte';
	import { rememberPlace } from '../../lib/lastPlace';
	import { rememberRecent } from '../../lib/recents';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	$effect(() => {
		if (!data.place) return;
		rememberPlace(location.pathname + location.search);
		rememberRecent(
			data.placeId
				? { kind: 'place', id: data.placeId }
				: { kind: 'search', q: data.q, label: data.place.label }
		);
	});
	const radii = [5, 10, 25, 50];
	const base = $derived(
		data.placeId
			? `/search?place=${encodeURIComponent(data.placeId)}`
			: `/search?q=${encodeURIComponent(data.q)}`
	);
</script>

<svelte:head>
	<title
		>{data.pageTitle ??
			(data.place ? `${data.place.label} · ${APP_NAME}` : `Search · ${APP_NAME}`)}</title
	>
</svelte:head>

<header class="top">
	<a class="brand" href="/">What's Up Ahead</a>
	<span class="top-title top-narrow">{data.placeId ? 'Place' : 'Search'}</span>
	<SearchBox value={data.placeId ? '' : data.q} />
</header>

<main>
	{#if !data.q}
		<p class="empty">Enter a location to see what's nearby.</p>
	{:else if data.failed}
		<p class="empty">The location search is not responding. Try again in a moment.</p>
	{:else if !data.place}
		<p class="empty">Couldn't find “{data.q}”. Try a zip code or a town name.</p>
	{:else}
		<section class="summary">
			<h1>{data.place.label}</h1>
			<div class="page-actions">
				<ShareButton
					path={base}
					title={data.place.label}
					text="Cameras and weather at {data.place.label}"
				/>
			</div>
			<nav class="radius" aria-label="Search radius">
				{#each radii as r (r)}
					<a href="{base}&r={r}" aria-current={r === data.radius ? 'true' : undefined}>{r} mi</a>
				{/each}
			</nav>
		</section>

		{#if 'skiSnow' in data && data.skiSnow}
			{#await data.skiSnow then snow}
				{#if snow}<SkiSnowLine {snow} full report={data.snowReport} />{/if}
			{/await}
		{/if}
		<PlaceBody {data} {base} />
	{/if}
</main>
