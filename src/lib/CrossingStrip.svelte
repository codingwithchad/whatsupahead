<script lang="ts">
	import { localClock } from './format';
	import type { Crossing } from './server/crossing';

	// "Best time to cross": the summit's forecast for each time you could leave, so a storm shows as arriving
	// before, while or after you'd cross. Tapping a time plans the drive for it.
	let {
		crossing,
		leaveIn,
		link
	}: { crossing: Crossing; leaveIn: number; link: (leaveIn: number) => string } = $props();

	const short = (ms: number) =>
		localClock(ms).replace(':00', '').replace(' AM', 'a').replace(' PM', 'p');
	const leaveAt = (minutes: number) => Date.now() + minutes * 60_000;
	/** The slot for the leave time chosen now (to the nearest hour). */
	const chosen = $derived(Math.round(leaveIn / 60) * 60);
	const word = { snow: 'snow', freezing: 'freezing', clear: 'above freezing' } as const;
</script>

<section class="crossing" aria-label="Best time to cross {crossing.pass}">
	<h2>
		Best time to cross {crossing.pass}{crossing.feet
			? ` (${crossing.feet.toLocaleString()} ft)`
			: ''}
	</h2>
	<p class="sub">The summit when you'd get there, by when you leave. Tap a time to plan for it.</p>
	<ol class="crossing-slots">
		{#each crossing.slots as s (s.leaveIn)}
			<li>
				<a
					class="slot slot-{s.level}"
					href={link(s.leaveIn)}
					aria-current={s.leaveIn === chosen ? 'true' : undefined}
					aria-label="Leave {s.leaveIn === 0
						? 'now'
						: `at ${localClock(leaveAt(s.leaveIn))}`}: {s.tempF ?? '?'}°F and {word[
						s.level
					]} at the summit around {localClock(s.at)}"
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
		<span class="k"><i class="slot-snow"></i> ❄ snow</span>
		<span class="k"><i class="slot-freezing"></i> freezing</span>
		<span class="k"><i class="slot-clear"></i> above freezing</span>
	</p>
</section>
