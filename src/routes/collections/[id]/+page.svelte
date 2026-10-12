<script lang="ts">
	import { loadOpenStates, saveOpenState } from '../../../lib/openStates';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	// With more than one state, each folds (most people want one); the ones opened before open again.
	let opened = $state<Record<string, boolean>>({});
	$effect(() => {
		opened = loadOpenStates();
	});
	const folds = $derived(data.groups.length > 1);
	const isOpen = (name: string) => !folds || (opened[name] ?? false);
	const toggled = (name: string) => (e: Event) => {
		const open = (e.currentTarget as HTMLDetailsElement).open;
		if (folds && open !== isOpen(name)) {
			opened[name] = open;
			saveOpenState(name, open);
		}
	};
</script>

<svelte:head><title>{data.collection.name} · What's Up Ahead</title></svelte:head>

<header class="top">
	<a class="brand" href="/">What's Up Ahead</a>
	<span class="top-title">{data.collection.name}</span>
</header>

<main>
	<h1>{data.collection.name}</h1>
	{#if data.collection.blurb}<p class="lede-dark">{data.collection.blurb}</p>{/if}
	{#each data.groups as group (group.state)}
		<details
			class="tree-region state-fold"
			class:single={!folds}
			open={isOpen(group.state)}
			ontoggle={toggled(group.state)}
		>
			<summary>
				<span class="tree-name">{group.state}</span>
				<span class="tree-count"
					>{group.places.length} {group.places.length === 1 ? 'place' : 'places'}</span
				>
			</summary>
			<nav class="places grid-places" aria-label="{data.collection.name}: {group.state}">
				{#each group.places as place (place.id)}
					<a class="place" href="/search?place={encodeURIComponent(place.id)}">
						<span class="cover">
							{#if place.cover}<img src={place.cover.url} alt="" loading="lazy" />{/if}
							<span class="live"><i></i> Live</span>
						</span>
						<span class="place-body">
							<span class="place-name">{place.name}</span>
							{#if place.blurb}<span class="place-sub">{place.blurb}</span>{/if}
							{#if data.glances}
								{#await data.glances}
									<span class="glance glance-loading">Checking the line…</span>
								{:then glances}
									{#if glances[place.id]}
										<span class="glance glance-{glances[place.id].tone}"
											>{glances[place.id].text}</span
										>
									{/if}
								{/await}
							{/if}
							<span class="place-count">{place.liveCameras} live cameras</span>
						</span>
					</a>
				{/each}
			</nav>
		</details>
	{/each}
</main>
