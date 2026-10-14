// Windy's camera titles read "Town – Direction: View", "Town: Region, Country: View" or just "Town – Direction".
// Shown as written they bury what the camera looks at ("Incline Village – North-west: Mt. Rose - Ski Tahoe"), so
// lead with the view and put the town and direction after it: "Mt. Rose - Ski Tahoe (Incline Village, looking
// north-west)". Plain JavaScript so the Windy importer (scripts/import-windy.mjs) uses the same rule.

/**
 * @param {string} title Windy's title, with "›" already turned into "–".
 * @returns {string}
 */
export function tidyWindyName(title) {
	const parts = title.split(/:\s+/).map((s) => s.trim());
	const head = parts[0];
	const [town, direction] = head.split(/\s+–\s+/);
	const looking = direction ? `looking ${direction.toLowerCase()}` : '';
	// The view is the last part; a middle part is a region or country ("California, United States").
	let view = parts.length > 1 ? parts[parts.length - 1] : '';
	view = view
		.replace(/,?\s*\((USA|United States)\)$/i, '')
		.replace(/,\s*(Washington|Oregon|California|Idaho|Nevada)$/i, '')
		.trim();
	// Only a state or country ("California, United States") is not a view.
	if (/^(Washington|Oregon|California|Idaho|Nevada)?(,?\s*United States)?$/i.test(view)) view = '';
	if (!view) return looking ? `${town}, ${looking}` : town;
	const where = [view.toLowerCase().includes(town.toLowerCase()) ? '' : town, looking]
		.filter(Boolean)
		.join(', ');
	return where ? `${view} (${where})` : view;
}
