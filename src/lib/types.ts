import type { PassReportSource } from './passes';
export type Availability = 'live' | 'seasonal';

interface Located {
	id: string;
	name: string;
	lat: number;
	lon: number;
	source: string;
	status: 'pending' | 'approved';
	availability?: Availability;
	expected_return?: string;
	seasonal_note?: string;
	page_url?: string;
	attribution_text?: string;
	location_precision?: 'exact' | 'approximate';
	tags?: string[];
}

export interface Camera extends Located {
	feed_url?: string;
	/** Ground height in meters (cameras near ski areas, from scripts/add-camera-heights.mjs). */
	elevation_m?: number;
	/** Serve a smaller copy of the picture (pixels wide) for very large sources. */
	max_width?: number;
	/** Serve our own periodically refreshed copy instead of linking the owner's picture (ODOT's terms). */
	mirror?: boolean;
	provider?: 'windy';
	provider_ref?: string;
	view?: ProviderView;
	feed_type: 'image' | 'video' | 'stream';
	embed_mode?: 'direct' | 'iframe' | 'proxy' | 'link';
	refresh_seconds?: number;
	description?: string;
	route?: string;
	milepost?: number;
}

export interface WeatherSource extends Located {
	kind:
		| 'forecast'
		| 'station'
		| 'pass-conditions'
		| 'waves'
		| 'tides'
		| 'ferry'
		| 'border'
		| 'airport'
		| 'river';
	provider?:
		| 'nws'
		| 'wsdot-weather'
		| 'wsdot-pass'
		| 'dot-pass'
		| 'ndbc'
		| 'noaa-tides'
		| 'wsdot-ferry'
		| 'wsdot-border'
		| 'faa-status'
		| 'nws-obs'
		| 'nwps';
	provider_ref?: string;
	requires_key?: string;
	elevation_ft?: number;
}

export interface FeaturedPlace {
	id: string;
	name: string;
	region?: string;
	/** The state, for grouping the places directory. Defaults to the region its coordinates are in. */
	state?: string;
	blurb?: string;
	lat: number;
	lon: number;
	radius_miles?: number;
	order?: number;
	collection?: string;
	/** Report kinds to show for this place beyond the usual ones, e.g. ["ferry"]. */
	include_kinds?: string[];
	/** List only cameras carrying one of these tags (a themed place, e.g. scenic views). */
	camera_tags?: string[];
	/** How far to look for weather reports, when that should be smaller than the camera radius. */
	weather_radius_miles?: number;
	note?: string;
	link?: { label: string; url: string };
	/** Other states it belongs to as well (Heavenly, on the California-Nevada line). */
	also_states?: string[];
	/** Ski areas: the resort's own snow report page. */
	snow_report_url?: string;
}

export interface Collection {
	id: string;
	name: string;
	blurb?: string;
	icon?: string;
	also?: string[];
	order?: number;
}

export interface Drive {
	id: string;
	name: string;
	blurb?: string;
	from: string;
	from_label?: string;
	to: string;
	to_label?: string;
	order?: number;
	/** When it shows on the home page, "MM-DD" to "MM-DD" (may wrap past New Year). */
	season?: { from: string; to: string };
	state?: string;
}

export interface Place {
	lat: number;
	lon: number;
	label: string;
}

export type Nearby<T> = T & { distance: number };

/** Extra details for cameras whose picture link comes from a provider API at view time. */
export interface ProviderView {
	link: string;
	owner: string | null;
	modified: string | null;
	width: number;
}

export interface Conditions {
	id: string;
	name: string;
	kind: WeatherSource['kind'];
	source: string;
	attribution?: string;
	page_url?: string;
	distance: number;
	returns?: string;
	/** For forecasts: the time (ms) this forecast is for, when it is not "now". */
	at?: number;
	/** For road-conditions reports: the one-word state of the pass, shown as a coloured tag. */
	badge?: { label: string; tone: 'closed' | 'chains' | 'traction' | 'open' | 'off-season' };
	state: 'ok' | 'dormant' | 'error';
	note?: string;
	rows: { label: string; value: string }[];
	/** For ferries: a one-line summary such as "Next 2 boats full", shown above the sailings. */
	glance?: { text: string; tone: 'ok' | 'busy' | 'full' | 'info' };
}

export interface SeasonalClosure {
	from: string;
	to: string;
}

export interface PassInfo {
	id: string;
	name: string;
	/** WSDOT's pass number (Washington passes). */
	pass_id?: number;
	/** Oregon and California passes: where their report comes from. */
	report?: PassReportSource;
	/** The road ends up there (at a ski area): nothing to cross, no other way across. */
	dead_end?: boolean;
	/** For roads that close for the winter, e.g. "Closed for the winter, usually November to late May". */
	winter_closure?: string;
	/** Its usual closing and opening days, "11-01" to "05-31" (a little wide on purpose). */
	seasonal_closure?: SeasonalClosure;
	/** The state's own page for this road. */
	link?: { label: string; url: string };
	route: string;
	connects: string;
	group: string;
	lat: number;
	lon: number;
	elevation_ft?: number;
	/** The place page for this pass (its cameras and weather). */
	place: string;
	/** The highway some miles each side of the summit, as an encoded line (scripts/build-pass-roads.mjs). */
	road?: string;
}
