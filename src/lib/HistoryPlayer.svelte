<script lang="ts">
	import { ago, duration, localClock } from './format';
	import ShareButton from './ShareButton.svelte';
	import { track } from './track';

	let { id, name = '' }: { id: string; name?: string } = $props();

	// The replay plays the last two hours; older pictures (one every half hour, up to six hours) are only
	// for a before-and-after.
	const REPLAY_MS = 2 * 60 * 60_000;
	let all = $state<{ t: number }[]>([]);
	const frames = $derived(all.filter((f) => f.t >= (all.at(-1)?.t ?? 0) - REPLAY_MS));
	let canShare = $state(false);
	let mode = $state<'loading' | 'none' | 'building' | 'ready'>('loading');
	let idx = $state(0);
	let playing = $state(true);

	$effect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch(`/api/history/${encodeURIComponent(id)}`);
				if (!res.ok) return void (mode = 'none');
				const body = (await res.json()) as { frames: { t: number }[]; moments?: boolean };
				if (cancelled) return;
				all = body.frames;
				canShare = Boolean(body.moments);
				idx = Math.max(0, frames.length - 1);
				// Fetch every picture up front so the replay plays smoothly.
				for (const f of frames) new Image().src = src(f.t);
				mode = frames.length >= 3 ? 'ready' : 'building';
			} catch {
				mode = 'none';
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	// Play through the pictures, pause briefly on the newest one, then start over.
	$effect(() => {
		if (mode !== 'ready' || !playing) return;
		const timer = setTimeout(
			() => (idx = idx >= frames.length - 1 ? 0 : idx + 1),
			idx >= frames.length - 1 ? 1400 : 330
		);
		return () => clearTimeout(timer);
	});

	// Before and after: the newest picture next to one from 30 minutes to 6 hours earlier.
	const BACK = [30, 60, 120, 180, 240, 360];
	const choices = $derived.by(() => {
		const newest = all.at(-1);
		if (!newest) return [];
		const out: { minutes: number; t: number }[] = [];
		for (const minutes of BACK) {
			const target = newest.t - minutes * 60_000;
			const near = all.reduce((a, b) => (Math.abs(b.t - target) < Math.abs(a.t - target) ? b : a));
			if (Math.abs(near.t - target) <= 20 * 60_000 && !out.some((o) => o.t === near.t))
				out.push({ minutes, t: near.t });
		}
		return out;
	});
	let picking = $state(false);
	let before = $state<number | null>(null);
	let link = $state<string | null>(null);
	let busy = $state(false);
	let failed = $state(false);

	async function pick(t: number) {
		const after = all.at(-1)?.t;
		if (!after) return;
		before = t;
		link = null;
		failed = false;
		busy = true;
		try {
			const res = await fetch('/api/moments', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ camera: id, before: t, after })
			});
			if (!res.ok) throw new Error(String(res.status));
			link = ((await res.json()) as { path: string }).path;
		} catch {
			failed = true;
		} finally {
			busy = false;
		}
	}

	function openPicker() {
		picking = !picking;
		track('moment-open');
		if (picking && !before && choices.length) void pick(choices[choices.length - 1].t);
	}

	const src = (t: number) => `/api/history/${encodeURIComponent(id)}/${t}`;
	const span = $derived(
		frames.length > 1 ? Math.round((frames[frames.length - 1].t - frames[0].t) / 60000) : 0
	);
	const spanText = $derived(
		span >= 60
			? `${Math.floor(span / 60)} h ${span % 60 ? `${span % 60} min` : ''}`.trim()
			: `${span} min`
	);
</script>

{#if mode === 'ready'}
	<section class="replay" aria-label="Replay of recent pictures">
		<div class="replay-head">
			<strong>Replay: last {spanText}</strong>
			<span class="sub">{ago(new Date(frames[idx].t).toISOString())}</span>
		</div>
		<img src={src(frames[idx].t)} alt="Camera replay frame" />
		<div class="replay-controls">
			<button
				class="secondary"
				onclick={() => (playing = !playing)}
				aria-label={playing ? 'Pause replay' : 'Play replay'}
			>
				{playing ? 'Pause' : 'Play'}
			</button>
			<input
				type="range"
				min="0"
				max={frames.length - 1}
				value={idx}
				oninput={(e) => {
					playing = false;
					idx = Number((e.currentTarget as HTMLInputElement).value);
				}}
				aria-label="Scrub through the replay"
			/>
		</div>
		{#if canShare && choices.length}
			<button class="secondary moment-open" onclick={openPicker} aria-expanded={picking}>
				Share before and after
			</button>
			{#if picking}
				<div class="moment-pick">
					<p class="sub">The picture now, next to one from:</p>
					<div class="moment-choices">
						{#each choices as c (c.t)}
							<button
								class="chip"
								aria-pressed={before === c.t}
								onclick={() => pick(c.t)}
								disabled={busy}
							>
								{duration(c.minutes)} ago
							</button>
						{/each}
					</div>
					{#if before}
						<div class="moment moment-small">
							<figure>
								<img src={src(before)} alt="Before" />
								<figcaption>Before · {localClock(before)}</figcaption>
							</figure>
							<figure>
								<img src={src(all.at(-1)!.t)} alt="After" />
								<figcaption class="after">After · {localClock(all.at(-1)!.t)}</figcaption>
							</figure>
						</div>
					{/if}
					{#if busy}
						<p class="sub">Getting the link ready…</p>
					{:else if failed}
						<p class="error">Couldn't save these pictures. Try again in a moment.</p>
					{:else if link && before}
						<ShareButton
							path={link}
							title="{name || 'Camera'}: before and after"
							text="{name ? `${name}, ` : ''}{localClock(before)} and {localClock(all.at(-1)!.t)}"
						/>
					{/if}
				</div>
			{/if}
		{/if}
	</section>
{:else if mode === 'building'}
	<p class="sub replay-note">
		Replay is building: we save a picture about every 5 minutes, so check back soon.
	</p>
{/if}
