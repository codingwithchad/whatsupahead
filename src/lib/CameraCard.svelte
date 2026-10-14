<script lang="ts">
	import CameraMedia from './CameraMedia.svelte';
	import type { Camera, Nearby } from './types';

	let {
		camera,
		note,
		onopen,
		ondead
	}: {
		camera: Nearby<Camera>;
		note?: string;
		onopen?: () => void;
		ondead?: (dead: boolean) => void;
	} = $props();
</script>

<article class="card camera">
	<CameraMedia {camera} {onopen} {ondead} />
	<div class="meta">
		<h3>{camera.name}</h3>
		<p class="sub">
			{note ?? `${camera.distance.toFixed(1)} mi`}{camera.location_precision === 'approximate'
				? ' (approx.)'
				: ''}
			· {camera.attribution_text ?? camera.source}
		</p>
		{#if camera.view}
			<!-- Windy's terms: link every picture to Windy, whose page is the full view. -->
			<a class="windy-full" href={camera.view.link} target="_blank" rel="noopener"
				>Full size on Windy ↗</a
			>
		{/if}
	</div>
</article>
