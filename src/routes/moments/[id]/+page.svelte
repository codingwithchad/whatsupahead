<script lang="ts">
	import { APP_NAME } from '../../../lib/brand';
	import ShareButton from '../../../lib/ShareButton.svelte';
	import { track } from '../../../lib/track';
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
		<a
			class="chip save-picture"
			href="/og/moment/{data.id}?tall&save"
			download
			onclick={() => track('moment-save')}>Save picture</a
		>
		<a class="chip" href="/cameras/{data.camera.id}">See the latest picture</a>
		<ShareButton
			path="/moments/{data.id}"
			title="{data.camera.name}: before and after"
			text="{data.camera.name}, {data.words.before} and {data.words.after}"
		/>
	</div>
	<p class="hint">
		<strong>Save picture</strong> keeps a tall version for Instagram, a story or a Facebook group, with
		the times and whatsupahead.com on it.
	</p>
</main>
