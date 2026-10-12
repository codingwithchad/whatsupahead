<script lang="ts">
	import CameraList from './CameraList.svelte';
	import ConditionsBar from './ConditionsBar.svelte';
	import OfflineCameras from './OfflineCameras.svelte';
	import type { Camera, Conditions, Nearby } from './types';

	// The part of a place page under its title: the place's note, weather and reports, then its cameras.
	let {
		data,
		base
	}: {
		data: {
			note: string | null;
			link: { label: string; url: string } | null;
			place: { label: string };
			radius: number;
			cameras: (Nearby<Camera> & { view?: unknown })[];
			totalCameras: number;
			showingAll: boolean;
			fallback: boolean;
			offline: Nearby<Camera>[];
			conditions: Promise<Conditions[]>;
		};
		base: string;
	} = $props();
	const more = $derived(`${base}${base.includes('?') ? '&' : '?'}`);
</script>

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
		<a href="{more}r={data.radius}&all=1">Show all {data.totalCameras}</a>
	</p>
{/if}

{#if data.fallback}
	<p class="thinned">
		No live cameras within {data.radius} miles of {data.place.label}. These are the nearest ones,
		with their distance.
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
		Webcams provided by <a href="https://www.windy.com/" target="_blank" rel="noopener">windy.com</a
		>
		&mdash;
		<a href="https://www.windy.com/webcams/add" target="_blank" rel="noopener">add a webcam</a>
	</p>
{/if}
