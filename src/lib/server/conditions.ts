import { isDormant } from '../geo';
import type { Conditions, Nearby, WeatherSource } from '../types';
import { riverRows, type GaugeInfo, type StageFlow } from '../river';
import { classifyPass, toneOf, type RawPass } from '../passes';
import { allPassReports } from './passes';
import { getCatalog } from './catalog';
import { faaRows, observationRows } from '../airport';
import { hourlyRows, type HourlyPeriod } from '../forecast';
import { timeZoneAt } from '../regions';
import {
	borderGlance,
	borderRows,
	ferryGlance,
	ferryRows,
	nextSailingGlance,
	scheduleRows,
	type BorderReading,
	type Glance,
	type ScheduleCombo,
	type TerminalSpace
} from '../transit';
import { localStamp, parseBuoy, upcomingTides, type TidePrediction } from '../marine';
import { cached } from './cache';

const USER_AGENT = 'WhatsUpAhead (https://github.com/codingwithchad/whatsupahead)';
const TEN_MINUTES = 10 * 60 * 1000;
const WSDOT = 'https://wsdot.wa.gov/Traffic/api';

type Row = { label: string; value: string };

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
	const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
	if (!res.ok) throw new Error(`upstream ${res.status}`);
	return (await res.json()) as T;
}

const show = (v: unknown, unit = '') =>
	v === null || v === undefined || v === '' ? null : `${v}${unit}`;

function compact(rows: [string, string | null][]): Row[] {
	return rows
		.filter((r): r is [string, string] => r[1] !== null)
		.map(([label, value]) => ({ label, value }));
}

async function fetchNws(src: WeatherSource, at?: number): Promise<Row[]> {
	const ref = (src.provider_ref ?? `${src.lat},${src.lon}`).replace(/\s/g, '');
	const headers = { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' };
	const point = await cached(`nws:points:${ref}`, 24 * 60 * 60 * 1000, () =>
		getJson<{ properties: { forecast: string; forecastHourly: string } }>(
			`https://api.weather.gov/points/${ref}`,
			headers
		)
	);
	if (at !== undefined) {
		try {
			const hourly = await getJson<{ properties: { periods: HourlyPeriod[] } }>(
				point.properties.forecastHourly,
				headers
			);
			const rows = hourlyRows(hourly.properties.periods, at, 3, timeZoneAt(src.lat, src.lon));
			if (rows.length) return rows;
		} catch (err) {
			console.warn(
				`[conditions] ${src.id}: hourly forecast unavailable (${(err as Error).message})`
			);
		}
	}
	const forecast = await getJson<{
		properties: {
			periods: {
				name: string;
				temperature: number;
				temperatureUnit: string;
				windSpeed: string;
				windDirection: string;
				shortForecast: string;
			}[];
		};
	}>(point.properties.forecast, headers);
	return forecast.properties.periods.slice(0, 3).map((p) => ({
		label: p.name,
		value: `${p.temperature}°${p.temperatureUnit}, ${p.shortForecast}, wind ${p.windDirection} ${p.windSpeed}`
	}));
}

function wsdotKey(src: WeatherSource): string {
	const name = src.requires_key ?? 'WSDOT_CODE';
	const key = process.env[name];
	if (!key) throw new Error(`${name} is not set`);
	return key;
}

async function fetchWsdotPass(src: WeatherSource): Promise<Row[]> {
	const key = encodeURIComponent(wsdotKey(src));
	const raw = await getJson<RawPass>(
		`${WSDOT}/MountainPassConditions/MountainPassConditionsREST.svc/GetMountainPassConditionAsJson?AccessCode=${key}&PassConditionID=${encodeURIComponent(src.provider_ref ?? '')}`
	);
	const pass = classifyPass(raw);
	return compact([
		['Status', pass.label],
		...pass.restrictions
			.filter((r) => !/^no restrictions/i.test(r.text))
			.map((r): [string, string | null] => [r.direction || 'Restriction', r.text]),
		['Road', show(pass.road)],
		['Weather', show(pass.weather)],
		['Temperature', show(pass.tempF, '°F')],
		['Travel advisory', pass.advisory ? 'Active' : null]
	]);
}

/** An Oregon or California pass report (provider_ref is our pass id in data/passes). */
async function fetchDotPass(src: WeatherSource): Promise<Row[]> {
	const pass = getCatalog().passes.find((p) => p.id === src.provider_ref);
	if (!pass) throw new Error(`no pass ${src.provider_ref}`);
	const report = (await allPassReports([pass])).get(pass.id);
	if (!report) throw new Error('state feed not reachable');
	return compact([
		['Status', report.label],
		...report.restrictions.map((r): [string, string | null] => [
			r.direction || 'Restriction',
			r.text
		]),
		['Road', show(report.road)],
		['Weather', show(report.weather)],
		['Temperature', show(report.tempF, '°F')],
		['Winter', pass.winter_closure ?? null]
	]);
}

async function fetchWsdotStation(src: WeatherSource): Promise<Row[]> {
	const key = encodeURIComponent(wsdotKey(src));
	const w = await getJson<{
		TemperatureInFahrenheit?: number | null;
		WindSpeedInMPH?: number | null;
		WindGustSpeedInMPH?: number | null;
		WindDirectionCardinal?: string | null;
		RelativeHumidity?: number | null;
		PrecipitationInInches?: number | null;
		Visibility?: number | null;
		SkyCoverage?: string | null;
	}>(
		`${WSDOT}/WeatherInformation/WeatherInformationREST.svc/GetCurrentWeatherInformationByStationIDAsJson?AccessCode=${key}&StationID=${encodeURIComponent(src.provider_ref ?? '')}`
	);
	return compact([
		['Temperature', show(w.TemperatureInFahrenheit, '°F')],
		['Wind', show(w.WindSpeedInMPH, ` mph ${w.WindDirectionCardinal ?? ''}`.trimEnd())],
		['Gusts', show(w.WindGustSpeedInMPH, ' mph')],
		['Humidity', show(w.RelativeHumidity, '%')],
		['Precipitation', show(w.PrecipitationInInches, ' in')],
		['Visibility', show(w.Visibility, ' mi')],
		['Sky', show(w.SkyCoverage === 'N/A' ? null : w.SkyCoverage)]
	]);
}

async function fetchBuoy(src: WeatherSource): Promise<Row[]> {
	const res = await fetch(
		`https://www.ndbc.noaa.gov/data/realtime2/${encodeURIComponent(src.provider_ref ?? '')}.txt`,
		{
			headers: { 'User-Agent': USER_AGENT },
			signal: AbortSignal.timeout(8000)
		}
	);
	if (!res.ok) throw new Error(`upstream ${res.status}`);
	return parseBuoy(await res.text());
}

async function fetchTides(src: WeatherSource): Promise<Row[]> {
	const now = new Date();
	const tz = timeZoneAt(src.lat, src.lon);
	const stamp = localStamp(now, tz);
	const url = new URL('https://api.tidesandcurrents.noaa.gov/api/prod/datagetter');
	url.search = new URLSearchParams({
		product: 'predictions',
		application: 'whatsupahead',
		begin_date: stamp.slice(0, 10).replaceAll('-', ''),
		range: '48',
		datum: 'MLLW',
		station: src.provider_ref ?? '',
		time_zone: 'lst_ldt',
		units: 'english',
		interval: 'hilo',
		format: 'json'
	}).toString();
	const data = await getJson<{ predictions?: TidePrediction[] }>(url.toString(), {
		'User-Agent': USER_AGENT
	});
	return upcomingTides(data.predictions ?? [], stamp);
}

// Sailing space and border waits change by the minute: fetched at most every two minutes, shared by the place
// pages and the at-a-glance lines on the ferry and border lists.
// WSF answers 400 for terminals it publishes no space for (the Vashon triangle, Port Townsend, Lopez...):
// treat that, and any outage, as "no space counts" so the schedule is shown instead.
const spaceOrNone = (src: WeatherSource) => sailingSpace(src).catch((): TerminalSpace => ({}));

function sailingSpace(src: WeatherSource): Promise<TerminalSpace> {
	const key = encodeURIComponent(wsdotKey(src));
	const ref = encodeURIComponent(src.provider_ref ?? '');
	return cached(`wsf:space:${ref}`, 2 * 60 * 1000, () =>
		getJson<TerminalSpace>(
			`https://www.wsdot.wa.gov/ferries/api/terminals/rest/terminalsailingspace/${ref}?apiaccesscode=${key}`
		)
	);
}

function borderReadings(src: WeatherSource): Promise<BorderReading[]> {
	const key = encodeURIComponent(wsdotKey(src));
	return cached('wsdot:border', 2 * 60 * 1000, () =>
		getJson<BorderReading[]>(
			`${WSDOT}/BorderCrossings/BorderCrossingsREST.svc/GetBorderCrossingsAsJson?AccessCode=${key}`
		)
	);
}

const lanes = (src: WeatherSource) => (src.provider_ref ?? '').split(',').map((n) => n.trim());

// Some terminals (the Vashon triangle, Port Townsend, Lopez...) have no drive-up space counts: list the schedule.
async function fetchFerry(src: WeatherSource): Promise<Row[]> {
	const rows = ferryRows(await spaceOrNone(src), Date.now());
	return rows.length ? rows : scheduleRows(await scheduleToday(src), Date.now());
}

async function fetchBorder(src: WeatherSource): Promise<Row[]> {
	return borderRows(await borderReadings(src), lanes(src));
}

/** Today's remaining sailings from a terminal to each of its destinations (WSF schedule API). */
async function scheduleToday(src: WeatherSource): Promise<ScheduleCombo[]> {
	const key = encodeURIComponent(wsdotKey(src));
	const id = encodeURIComponent(src.provider_ref ?? '');
	const base = 'https://www.wsdot.wa.gov/ferries/api/schedule/rest';
	const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
	const mates = await cached(`wsf:mates:${id}:${day}`, 6 * 60 * 60 * 1000, () =>
		getJson<{ TerminalID: number }[]>(`${base}/terminalmates/${day}/${id}?apiaccesscode=${key}`)
	);
	const combos = await Promise.all(
		mates.map((m) =>
			cached(`wsf:today:${id}:${m.TerminalID}`, 10 * 60 * 1000, () =>
				getJson<{ TerminalCombos: ScheduleCombo[] }>(
					`${base}/scheduletoday/${id}/${m.TerminalID}/true?apiaccesscode=${key}`
				)
			)
		)
	);
	return combos.flatMap((c) => c.TerminalCombos ?? []);
}

/** One line for a ferry or border card, before the place is opened. Null when there is nothing to say. */
export async function getGlance(src: WeatherSource): Promise<Glance | null> {
	try {
		if (src.provider === 'wsdot-ferry')
			return (
				ferryGlance(await spaceOrNone(src), Date.now()) ??
				nextSailingGlance(await scheduleToday(src), Date.now())
			);
		if (src.provider === 'wsdot-border') return borderGlance(await borderReadings(src), lanes(src));
	} catch (err) {
		console.warn(`[glance] ${src.id}: ${(err as Error).message}`);
	}
	return null;
}

async function fetchFaa(src: WeatherSource): Promise<Row[]> {
	const xml = await cached('faa:status', 2 * 60 * 1000, async () => {
		const res = await fetch('https://nasstatus.faa.gov/api/airport-status-information', {
			headers: { 'User-Agent': USER_AGENT },
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) throw new Error(`upstream ${res.status}`);
		return res.text();
	});
	return faaRows(xml, src.provider_ref ?? '');
}

async function fetchObservation(src: WeatherSource): Promise<Row[]> {
	const obs = await getJson<Parameters<typeof observationRows>[0]>(
		`https://api.weather.gov/stations/${encodeURIComponent(src.provider_ref ?? '')}/observations/latest`,
		{ 'User-Agent': USER_AGENT, Accept: 'application/geo+json' }
	);
	return observationRows(obs);
}

async function fetchRiver(src: WeatherSource): Promise<Row[]> {
	const id = encodeURIComponent(src.provider_ref ?? '');
	const headers = { 'User-Agent': USER_AGENT };
	const base = 'https://api.water.noaa.gov/nwps/v1/gauges';
	// Flood stages rarely change; the readings and forecast do.
	const gauge = await cached(`nwps:gauge:${id}`, 24 * 60 * 60 * 1000, () =>
		getJson<GaugeInfo>(`${base}/${id}`, headers)
	);
	const flow = await getJson<StageFlow>(`${base}/${id}/stageflow`, headers);
	return riverRows(gauge, flow, Date.now(), timeZoneAt(src.lat, src.lon));
}

const adapters: Record<
	NonNullable<WeatherSource['provider']>,
	(s: WeatherSource, at?: number) => Promise<Row[]>
> = {
	nws: fetchNws,
	'wsdot-pass': fetchWsdotPass,
	'dot-pass': fetchDotPass,
	'wsdot-weather': fetchWsdotStation,
	ndbc: fetchBuoy,
	'noaa-tides': fetchTides,
	'wsdot-ferry': fetchFerry,
	'wsdot-border': fetchBorder,
	'faa-status': fetchFaa,
	'nws-obs': fetchObservation,
	nwps: fetchRiver
};

/** Fetch live values for one source. Never throws: problems come back as state "error". */
export async function getConditions(
	src: Nearby<WeatherSource>,
	opts: { at?: number } = {}
): Promise<Conditions> {
	const base = {
		id: src.id,
		name: src.name,
		kind: src.kind,
		source: src.source,
		attribution: src.attribution_text,
		page_url: src.page_url,
		distance: src.distance,
		returns: src.expected_return
	};
	if (isDormant(src)) return { ...base, state: 'dormant', note: src.seasonal_note, rows: [] };
	const adapter = src.provider ? adapters[src.provider] : undefined;
	if (!adapter)
		return { ...base, state: 'error', note: 'No way to fetch this source yet.', rows: [] };
	try {
		// Sailing space and border waits change quickly; forecasts and readings do not.
		const fast =
			src.provider === 'wsdot-ferry' ||
			src.provider === 'wsdot-border' ||
			src.provider === 'faa-status' ||
			src.provider === 'dot-pass';
		// Forecasts for a future arrival time are asked for by the 10 minute slot so they can be cached.
		const at = src.kind === 'forecast' ? opts.at : undefined;
		const slot = at === undefined ? 'now' : Math.floor(at / 600_000);
		const rows = await cached(`wx:${src.id}:${slot}`, fast ? 2 * 60 * 1000 : TEN_MINUTES, () =>
			adapter(src, at)
		);
		if (!rows.length)
			return {
				...base,
				state: 'dormant',
				note: src.seasonal_note ?? 'No current readings.',
				rows: []
			};
		// Road-condition reports lead with a one-word status that gets a coloured tag.
		const tone =
			src.provider === 'wsdot-pass' || src.provider === 'dot-pass'
				? toneOf(rows[0]?.value ?? '')
				: undefined;
		// A boat wait is worth a line of its own at the top of the ferry report.
		const glance = src.provider === 'wsdot-ferry' ? await getGlance(src) : null;
		return {
			...base,
			state: 'ok',
			rows,
			...(glance?.tone === 'full' ? { glance } : {}),
			badge: tone ? { label: rows[0].value, tone } : undefined,
			at: at !== undefined && rows[0]?.label.startsWith('About') ? at : undefined
		};
	} catch (err) {
		console.warn(`[conditions] ${src.id}: ${(err as Error).message}`);
		return { ...base, state: 'error', note: 'Could not load right now. Try again soon.', rows: [] };
	}
}
