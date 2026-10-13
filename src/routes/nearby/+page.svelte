<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let status = $state<'idle' | 'locating' | 'denied'>('idle');

	// Opened without a position (a bookmark, say): ask the phone where it is.
	$effect(() => {
		if (data.point || !navigator.geolocation) return;
		status = 'locating';
		navigator.geolocation.getCurrentPosition(
			(pos) =>
				goto(`/nearby?ll=${pos.coords.latitude.toFixed(4)},${pos.coords.longitude.toFixed(4)}`, {
					replaceState: true
				}),
			() => (status = 'denied'),
			{ timeout: 10000 }
		);
	});
</script>

<svelte:head><title>Near me · What's Up Ahead</title></svelte:head>

<header class="top">
	<a class="brand" href="/">What's Up Ahead</a>
	<span class="top-title">Near me</span>
</header>

<main>
	<h1>Near you</h1>
	{#if !data.point}
		<p class="empty">
			{#if status === 'denied'}
				Location is turned off for this site. You can still search any town or zip on the
				<a href="/">home page</a>.
			{:else}
				Finding where you are…
			{/if}
		</p>
	{:else}
		<p class="lede-dark">
			Places we cover within 60 miles.
			<a href="/search?q={data.point.lat.toFixed(4)},{data.point.lon.toFixed(4)}"
				>See everything right here</a
			>
		</p>
		{#if data.results.length}
			<ul class="place-list">
				{#each data.results as r (r.id)}
					<li>
						<a href="/search?place={encodeURIComponent(r.id)}">
							<span class="place-name">{r.name}</span>
							<span class="place-sub">
								{r.distance.toFixed(r.distance < 10 ? 1 : 0)} mi away{r.kind
									? ` · ${r.kind}`
									: ''}{r.liveCameras ? ` · ${r.liveCameras} cameras` : ''}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty">
				We don't cover anywhere within 60 miles of you yet. Try searching a town or zip.
			</p>
		{/if}
	{/if}
</main>
