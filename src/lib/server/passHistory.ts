import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
	localDay,
	mergeHistory,
	pruneHistory,
	recordReport,
	seasonSummary,
	toDayStatus,
	type PassHistory
} from '../passHistory';
import { timeZoneAt } from '../regions';
import { getCatalog } from './catalog';
import { allPassReports } from './passes';

// Every 10 minutes, each pass's report is noted (the day keeps its worst), and the days are saved to a small
// file next to the visit counts, so the season's history survives restarts and deploys.

const FILE =
	process.env.PASS_HISTORY_FILE ||
	path.join(path.dirname(process.env.STATS_FILE || '.stats/stats.json'), 'pass-history.json');
const EVERY_MS = 10 * 60 * 1000;

let history: PassHistory | null = null;

function readFile(): PassHistory {
	try {
		return JSON.parse(readFileSync(FILE, 'utf8')) as PassHistory;
	} catch {
		return {};
	}
}

function current(): PassHistory {
	return (history ??= readFile());
}

/** Save, first adding in anything another copy of the app saved meanwhile (two run at once during a deploy). */
function save(today: string) {
	try {
		history = pruneHistory(mergeHistory(readFile(), current()), today);
		mkdirSync(path.dirname(FILE), { recursive: true });
		writeFileSync(`${FILE}.tmp`, JSON.stringify(history));
		renameSync(`${FILE}.tmp`, FILE);
	} catch (err) {
		console.warn(`[pass-history] could not save: ${(err as Error).message}`);
	}
}

/** Note every pass's report now. A pass whose state feed is down is skipped, not counted as "no report". */
export async function notePasses(now = Date.now()) {
	const { passes } = getCatalog();
	const reports = await allPassReports(passes);
	const h = current();
	let changed = false;
	let today = '';
	for (const p of passes) {
		const r = reports.get(p.id);
		if (!r) continue;
		const day = localDay(now, timeZoneAt(p.lat, p.lon));
		today = day > today ? day : today;
		if (recordReport(h, p.id, day, toDayStatus(r.status))) changed = true;
	}
	if (changed) save(today);
}

export function startPassHistory() {
	const run = () =>
		notePasses().catch((err) => console.warn(`[pass-history] ${(err as Error).message}`));
	void run();
	setInterval(run, EVERY_MS).unref();
}

/** This season so far for one pass, or null before we have any day for it. */
export function passSeason(pass: { id: string; lat: number; lon: number }, now = Date.now()) {
	return seasonSummary(current()[pass.id], localDay(now, timeZoneAt(pass.lat, pass.lon)));
}
