<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Fact, Verdict } from './verdict';

	let { verdict, children }: { verdict: Verdict; children?: Snippet } = $props();

	// Simple line icons (emoji look different on every phone, and some show none).
	const ICON: Record<Fact['icon'], string> = {
		pass: 'M3 19l6-10 4 6 2-3 6 7z',
		chains:
			'M3 12a3 3 0 0 1 3-3h4a3 3 0 0 1 0 6H6a3 3 0 0 1-3-3zM11 12a3 3 0 0 1 3-3h4a3 3 0 0 1 0 6h-4a3 3 0 0 1-3-3z',
		temp: 'M12 3a2 2 0 0 0-2 2v9a4 4 0 1 0 4 0V5a2 2 0 0 0-2-2z',
		snow: 'M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9',
		ice: 'M12 3l7 9-7 9-7-9z',
		warning: 'M12 3l10 18H2zM12 10v5M12 18v.5',
		closed: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM7 12h10',
		clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2'
	};
</script>

<section class="verdict verdict-{verdict.level}" aria-live="polite" aria-label="At a glance">
	<div class="verdict-top">
		<span class="verdict-mark" aria-hidden="true">
			{#if verdict.level === 'go'}
				<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
			{:else if verdict.level === 'stop'}
				<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17" /></svg>
			{:else if verdict.level === 'ready'}
				<svg viewBox="0 0 24 24"><path d="M12 6v8M12 18v.5" /></svg>
			{:else}
				<svg viewBox="0 0 24 24"
					><path d="M9.2 9a3 3 0 1 1 3.8 2.9c-.6.2-1 .7-1 1.3V14M12 18v.5" /></svg
				>
			{/if}
		</span>
		<div>
			<h2 class="verdict-title">{verdict.title}</h2>
			<p class="verdict-sentence">{verdict.sentence}</p>
		</div>
	</div>
	{#if verdict.facts.length}
		<ul class="verdict-facts">
			{#each verdict.facts as f (f.text)}
				<li class="fact-{f.tone}">
					<svg class="fact-icon" viewBox="0 0 24 24" aria-hidden="true"
						><path d={ICON[f.icon]} /></svg
					>
					{f.text}
				</li>
			{/each}
		</ul>
	{/if}
	{@render children?.()}
</section>
