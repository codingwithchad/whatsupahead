import { allowedKinds } from '../kinds';
import { distanceMiles, nearby, type Point } from '../geo';
import {
	cumulativeMiles,
	headingAt,
	projectNear,
	projectOnRoute,
	alongRoute,
	thinToTarget,
	type LatLon
} from '../route';
import { routeStops } from '../routeWeather';
import type { Conditions, FeaturedPlace, Nearby, WeatherSource } from '../types';
import type { PassReport } from '../passes';
import type { RoadWarnings } from '../roadAhead';
import type { RouteWeather } from '../routeWeather';
import { withForecast } from './autoForecast';
import { getCatalog } from './catalog';
import { getConditions } from './conditions';
import { nearestTown } from './gazetteer';
import { allPassReports } from './passes';
import { roadWarnings } from './roadAhead';
import { weatherOnTheWay } from './routeWeather';
import type { PassOnRoute } from './safeRoute';
import { snowAlong, type SnowReport } from './snow';
import { passesOnRoute } from './trip';

// What a drive page shows besides its cameras, worked out for a route and a start time. The page's first load
// uses it, and so does the page every few minutes while it stays open on the dash (/api/trip/live), so the
// pass reports, warnings and weather are never older than a few minutes. "Start time" is when the drive began,
// or, while following, the moment that puts you where you are now: every point's time is
// startAt + minutes × (miles along ÷ total miles).

/** Along the road only forecasts, roadside stations and rivers (passes have their own section). */
const ROADSIDE = new Set(['forecast', 'station', 'river']);

/** A pass on the drive as the page shows it. */
export interface RoadPass {
	id: string;
	name: string;
	route: string;
	place: string;
	link: { label: string; url: string } | null;
	source: string;
	along: number;
	heading: number | null;
	report: PassReport | null;
}

export function roadPass({ pass, along, heading, report }: PassOnRoute): RoadPass {
	return {
		id: pass.id,
		name: pass.name,
		route: pass.route,
		place: pass.place,
		link: pass.link ?? null,
		source:
			pass.pass_id !== undefined ? 'WSDOT' : pass.report?.source === 'odot' ? 'ODOT' : 'Caltrans',
		along,
		heading,
		report
	};
}

/** Every pass on the route with its report now. */
export async function passesNow(route: LatLon[]): Promise<RoadPass[]> {
	const cum = cumulativeMiles(route);
	const total = cum[cum.length - 1] ?? 0;
	const over = passesOnRoute(getCatalog().passes, route, total);
	const reports = await allPassReports(over);
	return over.map((pass) => {
		const along = projectOnRoute(pass, route, cum).along;
		return roadPass({
			pass,
			along,
			heading: headingAt(route, cum, along),
			report: reports.get(pass.id) ?? null
		});
	});
}

/** Weather sources for the drive, in driving order: along the road, plus anything that serves the destination. */
export function conditionSources(
	route: LatLon[],
	to: Point,
	featured: FeaturedPlace | undefined,
	destRadius: number
): { item: Nearby<WeatherSource>; along: number }[] {
	const { weather } = getCatalog();
	const sources = new Map<string, WeatherSource>();
	for (const w of alongRoute(
		weather.filter((x) => ROADSIDE.has(x.kind)),
		route,
		{ corridor: 3 }
	))
		sources.set(w.item.id, w.item);
	// Near the destination, ferry/airport/border reports only count if you are going to one.
	const destinationKinds = allowedKinds(featured);
	for (const w of nearby(
		weather.filter((x) => destinationKinds.has(x.kind)),
		to,
		destRadius
	))
		sources.set(w.id, w);
	// Always a forecast for where you are going, even where we have no weather files yet.
	for (const w of withForecast([...sources.values()], to, destRadius)) sources.set(w.id, w);
	const wx: Nearby<WeatherSource>[] = [...sources.values()].map((w) => ({
		...w,
		distance: distanceMiles(w, to)
	}));
	const cum = cumulativeMiles(route);
	return thinToTarget(
		wx
			.map((item) => ({
				item,
				along: (projectNear(item, route, cum, 5) ?? projectOnRoute(item, route, cum)).along
			}))
			.sort((a, b) => a.along - b.along)
			.map((x) => ({ ...x, keep: x.item.kind === 'forecast' || !ROADSIDE.has(x.item.kind) })),
		7
	);
}

/** Each source's report, for the time you reach it. */
export function conditionsAt(
	sources: { item: Nearby<WeatherSource>; along: number }[],
	total: number,
	minutes: number,
	startAt: number
): Promise<Conditions[]> {
	return Promise.all(
		sources.map(({ item, along }) =>
			getConditions(item, {
				at: startAt + (minutes * 60_000 * Math.min(along, total)) / Math.max(total, 0.1)
			})
		)
	);
}

export interface LiveRequest {
	route: LatLon[];
	minutes: number;
	startAt: number;
	from: Point & { label: string };
	to: Point & { label: string; featuredId?: string };
	demo?: boolean;
}

export interface LiveUpdate {
	at: number;
	startAt: number;
	passes: RoadPass[];
	warnings: RoadWarnings;
	onTheWay: RouteWeather | null;
	snow: SnowReport | null;
	conditions: Conditions[];
}

/** Everything fresh for a drive in one answer. Uses only free weather services and no routing. */
export async function liveUpdate(req: LiveRequest): Promise<LiveUpdate> {
	const now = Date.now();
	const cum = cumulativeMiles(req.route);
	const total = cum[cum.length - 1] ?? 0;
	const featured = req.to.featuredId
		? getCatalog().places.find((p) => p.id === req.to.featuredId)
		: undefined;
	const sources = conditionSources(req.route, req.to, featured, featured?.radius_miles ?? 3);
	const [passes, warnings, onTheWay, snow, conditions] = await Promise.all([
		passesNow(req.route),
		roadWarnings(req.route, req.minutes, req.startAt),
		weatherOnTheWay(
			routeStops(
				req.route,
				req.minutes,
				(req.startAt - now) / 60_000,
				{ from: req.from, to: req.to },
				getCatalog().passes,
				nearestTown
			),
			{ free: true }
		),
		snowAlong(req.route, req.startAt, req.minutes, req.demo),
		conditionsAt(sources, total, req.minutes, req.startAt)
	]);
	return { at: now, startAt: req.startAt, passes, warnings, onTheWay, snow, conditions };
}
