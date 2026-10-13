<script lang="ts">
	import Logo from '../lib/Logo.svelte';
	import { APP_NAME, COVERAGE_SHORT, TAGLINE } from '../lib/brand';
	import CollectionIcon from '../lib/CollectionIcon.svelte';
	import InstallHelp from '../lib/InstallHelp.svelte';
	import StartCard from '../lib/StartCard.svelte';
	import { loadRecents, type Recent } from '../lib/recents';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let recents = $state<Recent[]>([]);

	$effect(() => {
		recents = loadRecents();
	});

	const SHOWN = 3;
	const byId = $derived(new Map(data.places.map((p) => [p.id, p])));

	// Only places this person looked at on this device; what is popular for one visitor is not for another.
	const shown = $derived.by(() => {
		const ids: string[] = [];
		for (const r of recents)
			if (r.kind === 'place' && byId.has(r.id) && !ids.includes(r.id)) ids.push(r.id);
		return ids.slice(0, SHOWN).map((id) => byId.get(id)!);
	});
	const trips = $derived(
		recents.filter((r): r is Extract<Recent, { kind: 'trip' }> => r.kind === 'trip').slice(0, 3)
	);
	const searches = $derived(
		recents.filter((r): r is Extract<Recent, { kind: 'search' }> => r.kind === 'search').slice(0, 4)
	);
</script>

<svelte:head><title>{APP_NAME}: {TAGLINE}</title></svelte:head>

<header class="hero">
	<svg
		class="hero-art"
		viewBox="0 0 400 110"
		preserveAspectRatio="xMidYMax slice"
		aria-hidden="true"
	>
		<defs>
			<linearGradient id="hero-sky" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stop-color="#0b2540" />
				<stop offset="0.6" stop-color="#16607a" />
				<stop offset="1" stop-color="#f59e4b" />
			</linearGradient>
		</defs>
		<rect width="400" height="110" fill="url(#hero-sky)" />
		<circle cx="356" cy="92" r="13" fill="#ffd27a" opacity="0.9" />
		<path
			d="M0 110V76L40 50l22 16 38-28 40 34 30-14 40 28 40-32 40 24 40-18 70 22v22Z"
			fill="#0d3a52"
			opacity="0.9"
		/>
		<path d="M0 110V92l50-20 40 18 50-24 50 28 50-16 60 20 60-24 40 16v20Z" fill="#082b3f" />
		<path
			d="M200 110c10-9-10-13 5-19s10-9 3-13"
			fill="none"
			stroke="#ff9a2e"
			stroke-width="3"
			stroke-linecap="round"
		/>
	</svg>
	<div class="hero-content">
		<Logo />
		<div class="hero-text">
			<h1>What's Up Ahead</h1>
			<p class="tagline">{TAGLINE}</p>
			<p class="coverage">{COVERAGE_SHORT}</p>
		</div>
	</div>
</header>

<main class="home">
	<StartCard
		drives={data.drives}
		searches={searches.map((x) => ({ q: x.q, label: x.label }))}
		{trips}
	/>

	{#if data.collections.length}
		<h2 class="section-title">Explore</h2>
		<nav class="collections" aria-label="Explore">
			{#each data.collections as c (c.id)}
				<a
					class="collection"
					href={c.id === 'passes' ? '/passes' : `/collections/${encodeURIComponent(c.id)}`}
					title={c.blurb}
				>
					<CollectionIcon name={c.icon} />
					<span class="collection-name">{c.name}</span>
					<span class="collection-count">{c.places} places</span>
				</a>
			{/each}
			<a class="collection utility" href="/places">
				<CollectionIcon name="list" />
				<span class="collection-name">All places</span>
				<span class="collection-count">{data.places.length} to explore</span>
			</a>
			<a class="collection utility" href="/nearby">
				<CollectionIcon name="pin" />
				<span class="collection-name">Near me</span>
				<span class="collection-count">closest places</span>
			</a>
		</nav>
	{/if}

	{#if shown.length}
		<h2 class="section-title">Recent places</h2>
		<nav class="places" aria-label="Recent places">
			{#each shown as place (place.id)}
				<a class="place" href="/search?place={encodeURIComponent(place.id)}">
					<span class="cover">
						{#if place.cover}
							<img src={place.cover.url} alt="" loading="lazy" />
						{/if}
						<span class="live"><i></i> Live</span>
					</span>
					<span class="place-body">
						<span class="place-name">{place.name}</span>
						<span class="place-sub">{[place.region, place.blurb].filter(Boolean).join(' · ')}</span>
						<span class="place-count">{place.liveCameras} cameras</span>
					</span>
				</a>
			{/each}
		</nav>
	{/if}

	<InstallHelp />
</main>
