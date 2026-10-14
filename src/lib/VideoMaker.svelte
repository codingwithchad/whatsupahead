<script lang="ts">
	import { duration } from './format';
	import { recordVideo, snowLine, videoType, type VideoInput } from './replayVideo';
	import { track } from './track';

	// "Make a video" under a replay: the last hour, two hours or six hours of pictures as a short video to post
	// on Instagram or Facebook. Made on the phone; shared straight to an app where the phone allows it.
	let {
		id,
		name,
		frames,
		place,
		credit,
		timeZone,
		snow
	}: {
		id: string;
		name: string;
		frames: { t: number }[];
		place: string | null;
		credit: string;
		timeZone: string;
		snow: VideoInput['snow'];
	} = $props();

	const type = typeof window === 'undefined' ? null : videoType();
	const SPANS = [60, 120, 360];
	const newest = $derived(frames.at(-1)?.t ?? 0);
	// A stretch is offered when the replay reaches back far enough for it (within a quarter of it).
	const spans = $derived(
		SPANS.filter((m) => frames.length >= 3 && newest - frames[0].t >= m * 60_000 * 0.75)
	);
	let open = $state(false);
	let making = $state<number | null>(null);
	let progress = $state(0);
	let made = $state<{ url: string; file: File; minutes: number } | null>(null);
	let failed = $state(false);

	const src = (t: number) => `/api/history/${encodeURIComponent(id)}/${t}`;

	async function make(minutes: number) {
		if (!type) return;
		making = minutes;
		progress = 0;
		failed = false;
		if (made) URL.revokeObjectURL(made.url);
		made = null;
		try {
			const picked = frames.filter((f) => f.t >= newest - minutes * 60_000);
			const images = await Promise.all(
				picked.map(async (f) => {
					const image = new Image();
					image.src = src(f.t);
					await image.decode();
					return { t: f.t, image };
				})
			);
			const blob = await recordVideo(
				{ name, place, credit, timeZone, frames: images, snow },
				type,
				(p) => (progress = p)
			);
			const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
			const file = new File([blob], `${id}-${minutes}min.${ext}`, { type: blob.type });
			made = { url: URL.createObjectURL(file), file, minutes };
			track('replay-video');
		} catch {
			failed = true;
		} finally {
			making = null;
		}
	}

	const caption = $derived(
		made
			? [
					`${name}${place ? `, ${place}` : ''}: the last ${duration(made.minutes)}`,
					snowLine(snow, newest - made.minutes * 60_000, newest, timeZone),
					'whatsupahead.com'
				]
					.filter(Boolean)
					.join('. ')
			: ''
	);
	const canShareFile = $derived(
		Boolean(
			made && typeof navigator !== 'undefined' && navigator.canShare?.({ files: [made.file] })
		)
	);

	async function share() {
		if (!made) return;
		try {
			await navigator.share({ files: [made.file], title: name, text: caption });
			track('replay-video-share');
		} catch {
			// closed the share sheet
		}
	}
</script>

{#if type && spans.length}
	<button class="secondary video-open" onclick={() => (open = !open)} aria-expanded={open}>
		Make a video
	</button>
	{#if open}
		<div class="video-pick">
			<p class="sub">A short video of the pictures, to post or send:</p>
			<div class="moment-choices">
				{#each spans as m (m)}
					<button
						class="chip"
						aria-pressed={made?.minutes === m || making === m}
						disabled={making !== null}
						onclick={() => make(m)}
					>
						Last {duration(m)}
					</button>
				{/each}
			</div>
			{#if making !== null}
				<p class="sub" aria-live="polite">Making your video… {Math.round(progress * 100)}%</p>
			{:else if failed}
				<p class="error">
					Couldn't make the video on this phone. Try the before and after instead.
				</p>
			{:else if made}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video src={made.url} controls playsinline loop muted class="video-made"></video>
				<div class="video-actions">
					{#if canShareFile}
						<button onclick={share}>Share video</button>
					{/if}
					<a
						class="chip"
						href={made.url}
						download={made.file.name}
						onclick={() => track('replay-video-share')}>Save video</a
					>
				</div>
				{#if !made.file.type.includes('mp4')}
					<p class="sub">
						This phone made a WebM video. Instagram wants MP4; Facebook takes either.
					</p>
				{/if}
			{/if}
		</div>
	{/if}
{:else if type}
	<!-- Shown on every camera with a replay, so it's clear why there's no video yet. -->
	<button class="secondary video-open" disabled>Make a video</button>
	<p class="sub video-wait">
		A video needs about an hour of pictures. This camera's replay isn't that long yet.
	</p>
{/if}

<style>
	.video-pick {
		display: grid;
		gap: 8px;
		margin-top: 8px;
	}
	.video-made {
		width: 100%;
		max-width: 360px;
		border-radius: 8px;
		background: #04192a;
	}
	.video-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
</style>
