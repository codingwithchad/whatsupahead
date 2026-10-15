import { DEFAULT_TIME_ZONE } from './regions';

/** "2026-11" -> "November" (adds the year when it is not the current one). */
export function returnLabel(expected?: string, now: Date = new Date()): string | null {
	if (!expected) return null;
	const date = new Date(`${expected.slice(0, 7)}-01T12:00:00Z`);
	if (Number.isNaN(date.getTime())) return null;
	const month = date.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
	return date.getUTCFullYear() === now.getFullYear() ? month : `${month} ${date.getUTCFullYear()}`;
}

/** "2 min ago", "3 h ago". */
export function ago(iso: string, now: number = Date.now()): string {
	const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins} min ago`;
	const hours = Math.round(mins / 60);
	return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/** 83 -> "1 h 23 min", 120 -> "2 h". */
export function duration(minutes: number): string {
	const m = Math.round(minutes);
	if (m < 60) return `${m} min`;
	return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}

/** "2:55 PM" in the local time of the place it is about (see timeZoneAt in regions.ts). */
export function localClock(ms: number, timeZone: string = DEFAULT_TIME_ZONE): string {
	return new Intl.DateTimeFormat('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		timeZone
	}).format(new Date(ms));
}

/** "5:30 AM", or "5:30 AM tomorrow" when it falls on the next day there (looked up the night before). */
export function clockWithDay(
	ms: number,
	now: number = Date.now(),
	timeZone: string = DEFAULT_TIME_ZONE
): string {
	const day = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone });
	const clock = localClock(ms, timeZone);
	if (day(ms) === day(now)) return clock;
	return day(ms) === day(now + 86_400_000)
		? `${clock} tomorrow`
		: `${new Date(ms).toLocaleDateString('en-US', { timeZone, weekday: 'short' })} ${clock}`;
}
