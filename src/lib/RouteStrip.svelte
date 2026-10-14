<script lang="ts">
	import type { StopWeather } from './routeWeather';

	// The drive in one line, right under the answer: the start, each pass and the end, each with when you'll be
	// there, the temperature and snow or freezing. The full list stays under "More".
	let { stops, clock }: { stops: StopWeather[]; clock: (s: StopWeather) => string } = $props();

	const shown = $derived(stops.filter((s) => s.kind !== 'way'));
	const snowy = (s: StopWeather) => s.precip === 'snow' || s.hazards.some((h) => /snow/i.test(h));
	const freezing = (s: StopWeather) =>
		!snowy(s) && (s.precip === 'ice' || (s.tempF !== null && s.tempF <= 32));
	/** "Snoqualmie Pass" -> "Snoqualmie", "Yakima, WA" -> "Yakima". */
	const short = (s: StopWeather) => s.label.split(',')[0].replace(/\s+(Pass|Summit)$/, '');
</script>

{#if shown.length > 1}
	<ol class="route-strip" aria-label="On the way, for when you get to each point">
		{#each shown as s, i (i)}
			<li
				class:snowy={snowy(s)}
				class:freezing={freezing(s)}
				aria-label="{s.label} about {clock(s)}: {s.tempF ?? '?'}°F{snowy(s)
					? ', snow'
					: freezing(s)
						? ', freezing'
						: ''}"
			>
				<span class="rs-name">{short(s)}</span>
				<span class="rs-time">{clock(s)}</span>
				<span class="rs-temp"
					>{#if snowy(s)}<span aria-hidden="true">❄ </span>{:else if freezing(s)}<span
							aria-hidden="true"
							>🧊
						</span>{/if}{s.tempF !== null ? `${s.tempF}°` : '–'}</span
				>
			</li>
		{/each}
	</ol>
{/if}
