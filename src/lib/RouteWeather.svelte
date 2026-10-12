<script lang="ts">
	import { duration, localClock } from './format';
	import { timeZoneAt } from './regions';
	import { headline, type RouteWeather, type StopWeather } from './routeWeather';

	let { weather, leaveIn = 0 }: { weather: RouteWeather; leaveIn?: number } = $props();

	const now = Date.now();
	const clock = (s: StopWeather) =>
		localClock(now + s.minutesIn * 60_000, timeZoneAt(s.lat, s.lon));
	const level = (s: StopWeather) => (s.hazard >= 3 ? 'high' : s.hazard >= 2 ? 'some' : 'none');
	const line = (s: StopWeather) =>
		[
			s.tempF !== null ? `${s.tempF}°F` : null,
			s.phrase || null,
			s.gustMph && s.gustMph >= 20 ? `gusts ${s.gustMph} mph` : null
		]
			.filter(Boolean)
			.join(' · ');
	const label = (s: StopWeather) =>
		s.kind === 'start' ? (leaveIn ? `Leaving ${s.label}` : s.label) : s.label;
</script>

<section class="route-wx" aria-label="Weather on the way, for when you get to each point">
	<h2>Weather on the way</h2>
	<p class="route-wx-head">{headline(weather.stops)}</p>
	<ol>
		{#each weather.stops as s, i (i)}
			<li class="rw-{level(s)}">
				<span class="rw-when">
					<strong>{clock(s)}</strong>
					<small>{s.minutesIn < 1 ? 'now' : `in ${duration(s.minutesIn)}`}</small>
				</span>
				<span class="rw-where">
					{#if s.place}<a href="/search?place={encodeURIComponent(s.place)}">{label(s)}</a
						>{:else}{label(s)}{/if}
					{#if s.elevation_ft}<small>{s.elevation_ft.toLocaleString()} ft</small>{/if}
				</span>
				<span class="rw-wx">
					{line(s)}
					{#if s.hazard >= 2 && s.hazards[0]}<em class="rw-hazard">{s.hazards[0]}</em>{/if}
				</span>
			</li>
		{/each}
	</ol>
	<p class="rw-source">
		Forecast for the time you'll reach each point, from {weather.source}.
	</p>
</section>
