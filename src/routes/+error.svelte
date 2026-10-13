<script lang="ts">
	import { page } from '$app/state';

	// Any page that fails or doesn't exist: the same top bar as everywhere, a plain sentence, and a way on.
	const missing = $derived(page.status === 404);
</script>

<svelte:head
	><title>{missing ? 'Not found' : 'Something went wrong'} · What's Up Ahead</title></svelte:head
>

<header class="top">
	<a class="brand" href="/">What's Up Ahead</a>
	<span class="top-title">{missing ? 'Not found' : 'Error'}</span>
</header>

<main>
	<h1>{missing ? "We couldn't find that page" : 'Something went wrong'}</h1>
	<p class="lede-dark">
		{missing
			? (page.error?.message ?? 'The link may be old, or mistyped.')
			: 'One of our sources may be slow or down. Try again in a minute.'}
	</p>
	<nav class="radius" aria-label="Where to go">
		<a href="/">Home</a>
		<a href="/passes">Mountain passes</a>
		<a href="/places">All places</a>
	</nav>
</main>
