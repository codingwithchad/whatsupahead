<script lang="ts">
	import StatusPill from './StatusPill.svelte';
	import { duration } from './format';
	import type { LatLon } from './route';
	import type { RouteOption } from './server/routeOptions';
	import type { RoadPass } from './server/tripLive';
	import { NEED_TONE, passAnswer, type Vehicle } from './vehicle';

	// The other ways over the mountains: one line to glance at, and behind it a small drawn map and a list to
	// pick from. Each way says its extra time and what its pass asks of your car right now.
	let {
		options,
		baseline,
		current,
		vehicle,
		link
	}: {
		options: RouteOption[];
		/** This drive's time from the same service as the options (fair to compare), when known. */
		baseline: number | null;
		current: { line: LatLon[]; minutes: number; passes: RoadPass[]; from: string; to: string };
		vehicle: Vehicle | null;
		/** The drive's address going over this pass (or the fastest way when null). */
		link: (pass: { lat: number; lon: number } | null) => string;
	} = $props();

	const status = (p: RoadPass | undefined) => {
		if (!p?.report) return { tone: 'off-season' as const, text: 'No report' };
		if (vehicle) {
			const a = passAnswer(p.report, vehicle, p.heading);
			return { tone: NEED_TONE[a.need], text: a.text };
		}
		return { tone: p.report.status, text: p.report.label };
	};
	const diff = (minutes: number) => {
		const d = Math.round(minutes - (baseline ?? current.minutes));
		return Math.abs(d) < 5
			? 'about the same time'
			: d > 0
				? `${duration(d)} longer`
				: `${duration(-d)} shorter`;
	};
	// A pass with no report decides a way before an open one: not knowing is not the same as open.
	const ORDER = ['closed', 'chains', 'traction', 'off-season', 'open'];
	/** The way's strictest pass, which is what decides it. */
	const worstPass = (o: RouteOption) =>
		[...o.passes].sort((a, b) => ORDER.indexOf(status(a).tone) - ORDER.indexOf(status(b).tone))[0];
	const first = $derived(options[0]);

	// ---- The small map: every line drawn to one scale, north up ----
	const W = 340;
	const COLORS = ['var(--opt-1)', 'var(--opt-2)', 'var(--opt-3)'];
	/** A label beside its point, on the left when the point is near the right edge, so it stays on the map. */
	const label = (x: number) =>
		x > W - 110
			? { x: x - 7, 'text-anchor': 'end' as const }
			: { x: x + 7, 'text-anchor': 'start' as const };
	const box = $derived.by(() => {
		const all = [current.line, ...options.map((o) => o.line)].flat();
		const lats = all.map((p) => p[0]);
		const lons = all.map((p) => p[1]);
		const [s, n, w, e] = [
			Math.min(...lats),
			Math.max(...lats),
			Math.min(...lons),
			Math.max(...lons)
		];
		const k = Math.cos((((s + n) / 2) * Math.PI) / 180);
		const spanX = Math.max((e - w) * k, 0.01);
		const spanY = Math.max(n - s, 0.01);
		const pad = 16;
		const scale = (W - 2 * pad) / Math.max(spanX, spanY * 1.2);
		const H = Math.round(spanY * scale + 2 * pad + 8);
		return { s, n, w, k, scale, pad, H };
	});
	const xy = (p: { lat: number; lon: number } | LatLon) => {
		const [lat, lon] = Array.isArray(p) ? p : [p.lat, p.lon];
		return [
			box.pad + (lon - box.w) * box.k * box.scale,
			box.pad + 4 + (box.n - lat) * box.scale
		] as const;
	};
	const path = (line: LatLon[]) =>
		line.map((p, i) => `${i ? 'L' : 'M'}${xy(p)[0].toFixed(1)},${xy(p)[1].toFixed(1)}`).join('');
</script>

{#if first}
	<details class="route-options">
		<summary>
			<span class="ro-label">Other ways:</span>
			<strong>{first.label}</strong>
			<span class="ro-sub"
				>{diff(first.minutes)} · {status(worstPass(first)).text.toLowerCase()}</span
			>
		</summary>

		<svg
			class="ro-map"
			viewBox="0 0 {W} {box.H}"
			role="img"
			aria-label="Map of this drive and the other ways across"
		>
			{#each options as o, i (o.pass.id)}
				<path d={path(o.line)} class="ro-line" style:stroke={COLORS[i]} />
			{/each}
			<path d={path(current.line)} class="ro-line ro-current" />
			{#each [...current.passes.map( (p) => ({ name: p.name, at: p, mine: true }) ), ...options.map( (o) => ({ name: o.pass.name, at: o.pass, mine: false }) )] as m (m.name)}
				{@const [x, y] = xy(m.at)}
				<circle cx={x} cy={y} r="4" class:ro-mine={m.mine} class="ro-pass" />
				<text {...label(x)} y={y + 4} class="ro-text">{m.name.replace(/ Pass$/, '')}</text>
			{/each}
			{#each [[current.line[0], current.from], [current.line.at(-1), current.to]] as [p, name] (name)}
				{#if p}
					{@const [x, y] = xy(p as LatLon)}
					<rect x={x - 4} y={y - 4} width="8" height="8" class="ro-end" />
					<text {...label(x)} y={y + 4} class="ro-text ro-end-text">{name}</text>
				{/if}
			{/each}
		</svg>

		<ul class="ro-list">
			<li class="ro-item ro-this">
				<span class="ro-swatch ro-swatch-current"></span>
				<span class="ro-what">
					<strong>This drive</strong>{current.passes.length
						? `, over ${current.passes.map((p) => p.name).join(' and ')}`
						: ''}
					<small>{duration(current.minutes)}</small>
				</span>
				{#if current.passes[0]}
					{@const st = status(current.passes[0])}
					<StatusPill tone={st.tone} label={st.text} />
				{/if}
			</li>
			{#each options as o, i (o.pass.id)}
				{@const st = status(worstPass(o))}
				<li class="ro-item">
					<span class="ro-swatch" style:background={COLORS[i]}></span>
					<span class="ro-what">
						<strong>Over {o.label}</strong>
						<small>{diff(o.minutes)}</small>
					</span>
					<StatusPill tone={st.tone} label={st.text} />
					<a class="chip ro-go" href={link(o.pass)}>Drive this way</a>
				</li>
			{/each}
		</ul>
		<p class="ra-note">
			Compared without traffic. Tap a way to see its cameras, chains and weather. <a
				href={link(null)}>Fastest way</a
			>
		</p>
	</details>
{/if}
