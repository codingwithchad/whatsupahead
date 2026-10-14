<script lang="ts">
	import { localClock } from './format';
	import type { SkiSnow } from './server/skiSnow';

	// Snow at a ski area: on the ground, new in 24 hours and since 6 AM (from the nearest USDA SNOTEL gauge), and
	// still to fall today (Open-Meteo). `full` adds where each number comes from, for the ski area's own page.
	let {
		snow,
		full = false,
		report = null
	}: { snow: SkiSnow; full?: boolean; report?: string | null } = $props();

	const plus = (n: number) => (n > 0 ? `+${n}` : `${n}`);
	const bits = $derived(
		[
			snow.depthIn !== null
				? snow.depthIn < 2
					? 'Bare at the gauge'
					: `${snow.depthIn} in on the ground`
				: null,
			// Gauges wobble by an inch or so; smaller changes than these are not new snow.
			snow.change24 !== null && Math.abs(snow.change24) >= 2
				? `${plus(snow.change24)} in in 24 h`
				: null,
			snow.sinceSix !== null && snow.sinceSix >= 1 && (snow.depthIn ?? 0) >= 2
				? `${plus(snow.sinceSix)} in since 6 AM`
				: null,
			snow.forecastIn !== null && snow.forecastIn >= 0.5
				? `${Math.round(snow.forecastIn)} in more forecast today`
				: null
		].filter((b): b is string => b !== null)
	);
	const fresh = $derived(
		(snow.change24 ?? 0) >= 2 || ((snow.sinceSix ?? 0) >= 1 && (snow.depthIn ?? 0) >= 2)
	);
</script>

{#if full}
	<section class="ski-snow card" aria-label="Snow">
		<h2>Snow</h2>
		{#if snow.station && snow.link}
			<p class="ski-independent">
				<span class="ski-tag">Independent</span> Measured by the USDA's own snow gauge, not reported by
				the resort.
			</p>
		{/if}
		{#if bits.length}
			<p class="ski-snow-line" class:fresh>{bits.join(' · ')}</p>
		{:else}
			<p class="sub">No snow numbers for here right now.</p>
		{/if}
		<p class="sub">
			{#if snow.station && snow.link}
				SNOTEL gauge <a href={snow.link} target="_blank" rel="noopener">{snow.station}</a
				>{#if snow.stationFeet}&nbsp;({snow.stationFeet.toLocaleString()} ft{snow.miles !== null
						? `, ${snow.miles} mi away`
						: ''}){/if}{#if snow.at}, {localClock(snow.at, snow.timeZone)}{/if}.
			{:else}
				No USDA snow gauge within 10 miles.
			{/if}
			{#if snow.forecastIn !== null}Forecast from Open-Meteo.{/if}
			A gauge is one spot; the resort measures its own, and the two can differ.
		</p>
		{#if report}
			<p class="ski-report">
				Compare: <a href={report} target="_blank" rel="noopener">the resort's own snow report ↗</a>
			</p>
		{/if}
	</section>
{:else if bits.length}
	<span class="glance ski-snow-glance" class:fresh>{bits.join(' · ')}</span>
{/if}
