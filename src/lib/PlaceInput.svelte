<script lang="ts">
	interface Suggestion {
		label: string;
		sub: string;
		/** What goes in the box when picked, when not "label, sub" (our own places: their exact name). */
		value?: string;
	}

	let {
		name,
		value = $bindable(''),
		placeholder = '',
		label = '',
		required = false,
		type = 'text'
	}: {
		name: string;
		value?: string;
		placeholder?: string;
		label?: string;
		required?: boolean;
		type?: 'text' | 'search';
	} = $props();

	const listId = `suggest-${name}-${Math.random().toString(36).slice(2, 7)}`;
	let items = $state<Suggestion[]>([]);
	let open = $state(false);
	let active = $state(-1);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let sequence = 0;

	// As the visitor types, ask for matching places (after a short pause, and not for very short text).
	function onInput() {
		clearTimeout(timer);
		const q = value.trim();
		if (q.length < 2) {
			items = [];
			open = false;
			return;
		}
		timer = setTimeout(async () => {
			const mine = ++sequence;
			try {
				const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`);
				if (mine !== sequence || !res.ok) return;
				items = (await res.json()).suggestions;
				open = items.length > 0;
				active = -1;
			} catch {
				// no list is fine: typing the whole name and pressing the button still works
			}
		}, 220);
	}

	function pick(s: Suggestion) {
		value = s.value ?? (s.sub ? `${s.label}, ${s.sub}` : s.label);
		open = false;
		items = [];
		sequence++;
	}

	function onKey(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			active = (active + 1) % items.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = (active - 1 + items.length) % items.length;
		} else if (e.key === 'Enter' && active >= 0) {
			e.preventDefault();
			pick(items[active]);
		} else if (e.key === 'Escape') {
			open = false;
		}
	}
</script>

<div class="place-input">
	<input
		{name}
		{type}
		{placeholder}
		{required}
		aria-label={label || placeholder}
		autocomplete="off"
		role="combobox"
		aria-expanded={open}
		aria-autocomplete="list"
		aria-controls={listId}
		bind:value
		oninput={onInput}
		onkeydown={onKey}
		onblur={() => setTimeout(() => (open = false), 300)}
	/>
	{#if open}
		<ul class="suggest" id={listId} role="listbox">
			{#each items as s, i (s.label + s.sub)}
				<li role="option" aria-selected={i === active}>
					<button
						type="button"
						class:active={i === active}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => pick(s)}
					>
						<span class="suggest-name">{s.label}</span>
						{#if s.sub}<span class="suggest-sub">{s.sub}</span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
