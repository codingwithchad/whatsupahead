import type { YoutubeCheck } from './youtubeCheck';

/** What someone typed into the Add a camera form, already trimmed to length. */
export interface Suggestion {
	link: string;
	where: string;
	owner: string;
	terms: string;
	name: string;
}

/** Form text with control characters taken out; one line unless `lines` (the owner's terms can run several). */
export function cleanField(v: unknown, max: number, lines = false): string {
	const text = String(v ?? '')
		.replace(/\r\n?/g, '\n')
		.replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, ' ');
	return (lines ? text : text.replace(/\n/g, ' ')).trim().slice(0, max);
}

/** A web address a person could open: http or https, with a real host and no name or password in it. */
export function isWebAddress(link: string): boolean {
	if (!/^https?:\/\/\S+$/i.test(link)) return false;
	try {
		const url = new URL(link);
		return (
			['http:', 'https:'].includes(url.protocol) &&
			url.hostname.includes('.') &&
			!url.username &&
			!url.password
		);
	} catch {
		return false;
	}
}

/**
 * Text shown on GitHub exactly as typed: in a code span (or a code block when it runs over several lines), so
 * nobody can @mention people, add pictures or links, hide text in HTML, or add lines that look like our own
 * checks. The fence is longer than any run of backticks in the text, so the text can't close it.
 */
export function literal(text: string): string {
	if (!text) return '(not given)';
	const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
	if (text.includes('\n')) {
		const fence = '`'.repeat(Math.max(3, longest + 1));
		return `\n${fence}text\n${text}\n${fence}`;
	}
	const fence = '`'.repeat(longest + 1);
	return `${fence} ${text} ${fence}`;
}

/** The GitHub issue a suggestion becomes. Everything from the visitor (or from YouTube) is shown as plain text. */
export function suggestionIssue(
	s: Suggestion,
	yt: YoutubeCheck | null
): { title: string; body: string } {
	const lines = [
		'Sent from the Add a camera page on the website.',
		'',
		`**Where is it?** ${literal(s.where)}`,
		`**Who runs it?** ${literal(s.owner)}`,
		`**Link:** ${literal(s.link)}`,
		`**Does the owner allow public reuse?** ${literal(s.terms)}`,
		`**From:** ${literal(s.name)}`
	];
	if (yt)
		lines.push(
			'',
			'**YouTube check**',
			`- Title: ${literal(cleanField(yt.title, 200))}`,
			`- Channel: ${literal(cleanField(yt.channel, 200))}`,
			`- Embedding allowed: ${yt.embeddable ? 'yes' : 'NO'}`,
			`- Live right now: ${yt.live ? 'yes' : 'no'}`
		);
	lines.push(
		'',
		'_Not yet checked by a maintainer. Nothing is added until the owner and terms are confirmed._'
	);
	return { title: `Camera suggestion: ${s.where}`.slice(0, 120), body: lines.join('\n') };
}
