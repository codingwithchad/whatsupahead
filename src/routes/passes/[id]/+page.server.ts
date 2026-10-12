import { error } from '@sveltejs/kit';
import { distanceMiles } from '../../../lib/geo';
import { APP_NAME } from '../../../lib/brand';
import { previewSlot } from '../../../lib/sharing';
import { getCatalog } from '../../../lib/server/catalog';
import { avalancheAtPass, snowAtPass } from '../../../lib/server/mountain';
import { allPassReports, caltransCheckpoints } from '../../../lib/server/passes';
import { kmToStretch, sameRoute, type Checkpoint } from '../../../lib/passes';
import { passSeason } from '../../../lib/server/passHistory';
import { placePage } from '../../../lib/server/placePage';
import type { PassInfo } from '../../../lib/types';
import type { PageServerLoad } from './$types';

const ALTERNATES = 5;
// Caltrans checkpoints can sit 20 to 30 km down the mountain on either side of the summit.
const CHECKPOINT_KM = 40;

/** Caltrans chain-control checkpoints on this pass's highway, each way, nearest the summit first. */
async function checkpointsFor(pass: PassInfo): Promise<(Checkpoint & { km: number })[] | null> {
	if (pass.report?.source !== 'caltrans') return [];
	const all = await caltransCheckpoints();
	if (!all) return null;
	return all
		.filter((c) => sameRoute(c.route, pass.report!.route))
		.map((c) => ({ ...c, km: kmToStretch(c, pass) }))
		.filter((c) => c.km <= CHECKPOINT_KM)
		.sort((a, b) => a.direction.localeCompare(b.direction) || a.km - b.km);
}
const ALTERNATE_MILES = 120;

/** Other ways over the same mountains: passes in the same group first, then the nearest others, closest first. */
function alternatesFor(pass: PassInfo, passes: PassInfo[]): PassInfo[] {
	const others = passes
		.filter((p) => p.id !== pass.id && distanceMiles(p, pass) <= ALTERNATE_MILES)
		.sort((a, b) => distanceMiles(a, pass) - distanceMiles(b, pass));
	return [
		...others.filter((p) => p.group === pass.group),
		...others.filter((p) => p.group !== pass.group)
	].slice(0, ALTERNATES);
}

export const load: PageServerLoad = async ({ params, url, setHeaders, locals }) => {
	const { passes, places } = getCatalog();
	const pass = passes.find((p) => p.id === params.id);
	const featured = pass && places.find((p) => p.id === pass.place);
	if (!pass || !featured) error(404, 'No pass by that name');

	const alternates = alternatesFor(pass, passes);
	const [base, reports] = await Promise.all([
		// The pass report is shown at the top of this page, so the conditions below leave it out.
		placePage(featured, { url, setHeaders, locals, skipKinds: new Set(['pass-conditions']) }),
		allPassReports([pass, ...alternates])
	]);
	if (!('share' in base)) error(500, 'Pass page unavailable');
	const report = reports.get(pass.id) ?? null;

	// What a search result or shared link says: the pass as it is right now, and what the page has.
	const now = report && report.status !== 'off-season' ? report.label : null;
	const elevation = pass.elevation_ft ? `, ${pass.elevation_ft.toLocaleString()} ft` : '';
	const share = {
		...base.share,
		title: `${pass.name} conditions now`,
		description: `${pass.name} (${pass.route}${elevation})${now ? ` right now: ${now}.` : '.'} Live cameras, chains for your car, snow depth, avalanche danger and the forecast. Free, no app needed.`,
		image: `/og/search?place=${encodeURIComponent(featured.id)}&v=${previewSlot()}`
	};
	return {
		...base,
		share,
		canonical: `/passes/${encodeURIComponent(pass.id)}`,
		pageTitle: `${pass.name} Conditions Now: ${pass.route} Cameras, Chains & Weather · ${APP_NAME}`,
		pass: {
			id: pass.id,
			name: pass.name,
			route: pass.route,
			connects: pass.connects,
			elevation_ft: pass.elevation_ft ?? null,
			winter_closure: pass.winter_closure ?? null,
			link: pass.link ?? null,
			source:
				pass.pass_id !== undefined ? 'WSDOT' : pass.report?.source === 'odot' ? 'ODOT' : 'Caltrans'
		},
		report,
		season: passSeason(pass),
		alternates: alternates.map((p) => ({
			id: p.id,
			name: p.name,
			route: p.route,
			miles: distanceMiles(p, pass),
			report: reports.get(p.id) ?? null
		})),
		// Streamed: the page shows the report and cameras while these load.
		snow: snowAtPass(pass),
		checkpoints: checkpointsFor(pass),
		avalanche: avalancheAtPass(pass)
	};
};
