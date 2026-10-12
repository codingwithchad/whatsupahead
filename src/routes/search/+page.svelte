<script lang="ts">
	import { APP_NAME } from '../../lib/brand';
	import CameraList from '../../lib/CameraList.svelte';
	import ConditionsBar from '../../lib/ConditionsBar.svelte';
	import OfflineCameras from '../../lib/OfflineCameras.svelte';
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
	<title>{data.place ? `${data.place.label} · ${APP_NAME}` : `Search · ${APP_NAME}`}</title>
</svelte:head>

<header class="top">
	<a class="brand" href="/">What's Up Ahead</a>
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
					text="Live cameras and weather at {data.place.label}"
				/>
			</div>
			<nav class="radius" aria-label="Search radius">
				{#each radii as r (r)}
					<a href="{base}&r={r}" aria-current={r === data.radius ? 'true' : undefined}>{r} mi</a>
				{/each}
			</nav>
		</section>

		{#if data.note}
			<p class="place-note">
				{data.note}
				{#if data.link}<a href={data.link.url} target="_blank" rel="noopener">{data.link.label} ↗</a
					>{/if}
			</p>
		{/if}

		{#await data.conditions}
			<p class="loading">Loading conditions…</p>
		{:then conditions}
			<ConditionsBar {conditions} mode="place" />
		{/await}

		{#if !data.showingAll}
			<p class="thinned">
				Showing the nearest {data.cameras.length} of {data.totalCameras} cameras.
				<a href="{base}&r={data.radius}&all=1">Show all {data.totalCameras}</a>
			</p>
		{/if}

		{#if data.fallback}
			<p class="thinned">
				No live cameras within {data.radius} miles of {data.place.label}. These are the nearest
				ones, with their distance.
			</p>
		{/if}

		{#if data.cameras.length}
			<CameraList items={data.cameras.map((camera) => ({ camera }))} />
		{:else}
			<p class="empty">No live cameras within {data.radius} miles. Try a larger radius.</p>
		{/if}

		<OfflineCameras cameras={data.offline} />

		{#if data.cameras.some((c) => c.view)}
			<p class="courtesy">
				Webcams provided by <a href="https://www.windy.com/" target="_blank" rel="noopener"
					>windy.com</a
				>
				&mdash;
				<a href="https://www.windy.com/webcams/add" target="_blank" rel="noopener">add a webcam</a>
			</p>
		{/if}
	{/if}
</main>
