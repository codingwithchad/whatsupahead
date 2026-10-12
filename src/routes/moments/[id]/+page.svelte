<script lang="ts">
	import { APP_NAME } from '../../../lib/brand';
	import ShareButton from '../../../lib/ShareButton.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>{data.camera.name}: before and after · {APP_NAME}</title></svelte:head>

<header class="top">
	<a class="brand" href="/">{APP_NAME}</a>
	<span class="top-title">Before and after</span>
</header>

<main>
	<section class="summary">
		<h1>{data.camera.name}</h1>
		<p class="sub">Before and after, {data.words.apart} · {data.words.day}</p>
	</section>

	<div class="moment">
		<figure>
			<img src="/api/moments/{data.id}/before" alt="{data.camera.name} at {data.words.before}" />
			<figcaption>Before · {data.words.before}</figcaption>
		</figure>
		<figure>
			<img src="/api/moments/{data.id}/after" alt="{data.camera.name} at {data.words.after}" />
			<figcaption class="after">After · {data.words.after}</figcaption>
		</figure>
	</div>
	<p class="sub">
		Pictures: {data.credit}{data.camera.page_url ? ' · ' : ''}{#if data.camera.page_url}<a
				href={data.camera.page_url}
				target="_blank"
				rel="noopener">Source page</a
			>{/if}
	</p>

	<div class="page-actions">
		<a class="chip" href="/cameras/{data.camera.id}">See it live now</a>
		<ShareButton
			path="/moments/{data.id}"
			title="{data.camera.name}: before and after"
			text="{data.camera.name}, {data.words.before} and {data.words.after}"
		/>
	</div>
</main>
