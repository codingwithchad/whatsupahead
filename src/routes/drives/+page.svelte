<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head
	><title>Popular Drives: Road Conditions Over the Passes · What's Up Ahead</title></svelte:head
>

<header class="top">
	<a class="brand" href="/">What's Up Ahead</a>
	<span class="top-title">Popular drives</span>
</header>

<main>
	<h1>Popular drives</h1>
	<p class="lede-dark">
		The drives people take most, with the passes on the way, chains for your car and when to leave
		to miss the snow. For any other drive, put in where you're going on the <a href="/">home page</a
		>.
	</p>
	{#each data.states as st (st.name)}
		<h2 class="section-title">{st.name}</h2>
		<nav class="drives" aria-label="Drives in {st.name}">
			{#each st.drives as d (d.id)}
				<a class="drive" href="/drives/{encodeURIComponent(d.id)}">
					<span class="place-name">{d.name}</span>
					{#if d.blurb}<span class="place-sub">{d.blurb}</span>{/if}
				</a>
			{/each}
		</nav>
	{/each}
</main>
