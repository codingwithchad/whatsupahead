<script lang="ts">
	import { APP_NAME } from '../../../lib/brand';
	import CameraList from '../../../lib/CameraList.svelte';
	import CameraMedia from '../../../lib/CameraMedia.svelte';
	import HistoryPlayer from '../../../lib/HistoryPlayer.svelte';
	import ShareButton from '../../../lib/ShareButton.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const camera = $derived(data.camera);
	const near = $derived(data.place?.name ?? data.town);
	const aroundLink = $derived(
		data.place
			? `/search?place=${encodeURIComponent(data.place.id)}`
			: `/search?q=${camera.lat.toFixed(4)},${camera.lon.toFixed(4)}`
	);
</script>

<svelte:head><title>{camera.name} · {APP_NAME}</title></svelte:head>

<header class="top">
	<a class="brand" href="/">{APP_NAME}</a>
	<span class="top-title">Camera</span>
</header>

<main>
	<section class="summary">
		<h1>{camera.name}</h1>
		<p class="sub">
			{near ? `Near ${near} · ` : ''}{camera.attribution_text ?? camera.source}
			{#if camera.view}
				· <a href={camera.view.link} target="_blank" rel="noopener">Full size on Windy ↗</a>
			{:else if camera.page_url}
				· <a href={camera.page_url} target="_blank" rel="noopener">Source page</a>
			{/if}
		</p>
	</section>

	{#if data.dormant}
		<p class="notice">
			This camera is down for the season{data.back ? `, back in ${data.back}` : ''}.
		</p>
	{:else if camera.feed_url}
		<div class="camera-page-media"><CameraMedia {camera} large /></div>
		{#if camera.feed_type === 'image' && !camera.view}<HistoryPlayer
				id={camera.id}
				name={camera.name}
			/>{/if}
	{:else}
		<p class="notice">This camera's picture is not available right now.</p>
	{/if}

	<div class="page-actions">
		<ShareButton
			path="/cameras/{camera.id}"
			title={camera.name}
			text={`Live camera: ${camera.name}${near ? `, near ${near}` : ''}`}
		/>
		<a class="chip" href={aroundLink}>Everything near {near ?? 'here'}</a>
		<a
			class="chip"
			href="/trip?to={camera.lat.toFixed(4)},{camera.lon.toFixed(4)}&tl={encodeURIComponent(
				near ?? camera.name
			)}">Drive here</a
		>
	</div>

	{#if data.others.length}
		<h2 class="section-title">Cameras nearby</h2>
		<CameraList
			items={data.others.map((c) => ({ camera: c, note: `${c.distance.toFixed(1)} mi away` }))}
		/>
	{/if}

	{#if camera.view || data.others.some((c) => c.view)}
		<p class="courtesy">
			Webcams provided by <a href="https://www.windy.com/" target="_blank" rel="noopener"
				>windy.com</a
			>
			&mdash;
			<a href="https://www.windy.com/webcams/add" target="_blank" rel="noopener">add a webcam</a>
		</p>
	{/if}
</main>
