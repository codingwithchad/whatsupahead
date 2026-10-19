<script lang="ts">
	import { clockWithDay, localClock } from './format';
	import type { Crossing } from './server/crossing';

	// "Best time to cross": when to leave to miss the snow at the summits in the next day ("Leave before 5:30 AM
	// tomorrow to cross ahead of it"), and, folded away under "Pick a time to leave", the worst summit's forecast for
	// each hour you could leave. Tapping an hour plans the drive for it and folds the hours away again.
	let {
		crossing,
		leaveIn,
		link
	}: { crossing: Crossing; leaveIn: number; link: (leaveIn: number) => string } = $props();

	const tz = $derived(crossing.timeZone);
	const now = Date.now();
	// Later slots are on the clock's hour; the forecast may be a few minutes older than this page, so round to the
	// half hour (6:00, not 5:59).
	const leaveAt = (minutes: number) => Math.round((now + minutes * 60_000) / 1_800_000) * 1_800_000;
	let open = $state(false);
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
	const one = $derived(crossing.passes.length === 1);
	// "Blewett Pass (4,102 ft)", "Snoqualmie Pass and Blewett Pass", "the 3 passes".
	const title = $derived(
		one
			? `${crossing.passes[0].name}${crossing.passes[0].feet ? ` (${crossing.passes[0].feet.toLocaleString()} ft)` : ''}`
			: crossing.passes.length === 2
				? crossing.passes.map((p) => p.name).join(' and ')
				: `the ${crossing.passes.length} passes`
	);
	const summit = $derived(
		one ? 'the summit' : crossing.passes.length === 2 ? 'either summit' : 'any summit'
	);
</script>

<section class="crossing" aria-label="Best time to cross {title}">
	<h2>Best time to cross {title}</h2>
	<p class="crossing-advice">
		{#if !a.snow.length}
			No snow forecast at {summit} for a crossing in the next 24 hours.{#if a.freezing}
				It drops to freezing at times: watch for ice.{/if}
		{:else}
			{#each a.snow as s, i (s.pass)}{i === 0 ? 'Snow' : ', and'} at {one ? 'the summit' : s.pass} from
				about {when(s.from)}{s.until ? ` until about ${when(s.until)}` : ''}{/each}.
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
	<details class="crossing-hours" bind:open>
		<summary>Pick a time to leave</summary>
		<ol class="crossing-slots">
			{#each crossing.slots as s (s.leaveIn)}
				<li>
					<a
						class="slot slot-{s.level}"
						href={link(s.leaveIn)}
						onclick={() => (open = false)}
						aria-current={s.leaveIn === chosen ? 'true' : undefined}
						aria-label="Leave {s.leaveIn === 0
							? 'now'
							: `at ${when(leaveAt(s.leaveIn))}`}: {s.tempF ?? '?'}°F and {word[s.level]} at {one
							? 'the summit'
							: s.pass} around {when(s.at)}"
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
	</details>
</section>
