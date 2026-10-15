<script lang="ts">
	import { clockWithDay, localClock } from './format';
	import type { Crossing } from './server/crossing';

	// "Best time to cross": when to leave to miss the snow at the summit in the next day ("Leave before 5:30 AM
	// tomorrow to cross ahead of it"), and the summit's forecast for each hour you could leave. Tapping an hour
	// plans the drive for it.
	let {
		crossing,
		leaveIn,
		link
	}: { crossing: Crossing; leaveIn: number; link: (leaveIn: number) => string } = $props();

	const tz = $derived(crossing.timeZone);
	const now = Date.now();
	// To the nearest minute, so a slot on the hour reads 6:00, not 5:59.
	const leaveAt = (minutes: number) => Math.round((now + minutes * 60_000) / 60_000) * 60_000;
	const when = (ms: number) => clockWithDay(ms, now, tz);
	/** "5a", "12p": a slot's hour. */
	const short = (ms: number) =>
		localClock(ms, tz).replace(':00', '').replace(' AM', 'a').replace(' PM', 'p');
	/** The slot for the leave time chosen now (the nearest). */
	const chosen = $derived(
		crossing.slots.reduce((best, s) =>
			Math.abs(s.leaveIn - leaveIn) < Math.abs(best.leaveIn - leaveIn) ? s : best
		).leaveIn
	);
	const word = { snow: 'snow', freezing: 'freezing', clear: 'above freezing' } as const;
	const a = $derived(crossing.advice);
</script>

<section class="crossing" aria-label="Best time to cross {crossing.pass}">
	<h2>
		Best time to cross {crossing.pass}{crossing.feet
			? ` (${crossing.feet.toLocaleString()} ft)`
			: ''}
	</h2>
	<p class="crossing-advice">
		{#if a.snowFrom === null}
			No snow forecast at the summit for a crossing in the next 24 hours.{#if a.freezing}
				It drops to freezing at times: watch for ice.{/if}
		{:else}
			Snow at the summit from about {when(a.snowFrom)}{a.snowUntil
				? ` until about ${when(a.snowUntil)}`
				: ''}.
			{#if a.leaveBefore !== null}
				<strong>Leave before {when(a.leaveBefore)}</strong> to cross ahead of it{a.leaveAfter !==
				null
					? ','
					: '.'}
			{/if}
			{#if a.leaveAfter !== null}
				{a.leaveBefore !== null ? 'or' : ''}
				<strong>leave after {when(a.leaveAfter)}</strong> to cross once it has passed (plows need time
				too).
			{:else if a.leaveBefore === null}
				<strong>It keeps on through the next day</strong>: go prepared, or wait for the forecast to
				change.
			{/if}
		{/if}
	</p>
	<ol class="crossing-slots">
		{#each crossing.slots as s (s.leaveIn)}
			<li>
				<a
					class="slot slot-{s.level}"
					href={link(s.leaveIn)}
					aria-current={s.leaveIn === chosen ? 'true' : undefined}
					aria-label="Leave {s.leaveIn === 0
						? 'now'
						: `at ${when(leaveAt(s.leaveIn))}`}: {s.tempF ?? '?'}°F and {word[
						s.level
					]} at the summit around {when(s.at)}"
				>
					<span class="slot-time">{s.leaveIn === 0 ? 'Now' : short(leaveAt(s.leaveIn))}</span>
					<span class="slot-temp"
						>{#if s.level === 'snow'}❄{:else}{s.tempF ?? '–'}°{/if}</span
					>
				</a>
			</li>
		{/each}
	</ol>
	<p class="crossing-key">
		<span>By when you leave:</span>
		<span class="k"><i class="slot-snow"></i> ❄ snow</span>
		<span class="k"><i class="slot-freezing"></i> freezing</span>
		<span class="k"><i class="slot-clear"></i> above freezing</span>
	</p>
</section>
