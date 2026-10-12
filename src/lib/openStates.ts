// Which states a visitor has opened on the lists (passes, ski areas, parks...), kept on this device only, so the
// state they care about is already open next time. Shared by every list: open Oregon once, it opens everywhere.
const KEY = 'whatsupahead:open-states';

export function loadOpenStates(): Record<string, boolean> {
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
		return saved && typeof saved === 'object' ? saved : {};
	} catch {
		return {};
	}
}

export function saveOpenState(state: string, open: boolean) {
	try {
		localStorage.setItem(KEY, JSON.stringify({ ...loadOpenStates(), [state]: open }));
	} catch {
		// storage can be blocked (private mode); remembering is optional
	}
}
