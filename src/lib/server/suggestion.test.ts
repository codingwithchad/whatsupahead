import { describe, expect, it } from 'vitest';
import { cleanField, isWebAddress, literal, suggestionIssue } from './suggestion';

const base = {
	link: 'https://example.com/cam',
	where: 'Leavenworth',
	owner: '',
	terms: '',
	name: ''
};

describe('cleanField', () => {
	it('keeps one line, takes out control characters and caps the length', () => {
		expect(cleanField('Mukilteo\n**Embedding allowed:** yes', 200)).toBe(
			'Mukilteo **Embedding allowed:** yes'
		);
		expect(cleanField('a\u0000b\u2028c', 200)).toBe('a b c');
		expect(cleanField('x'.repeat(500), 60)).toHaveLength(60);
		expect(cleanField(null, 10)).toBe('');
	});

	it('keeps line breaks in the terms', () => {
		expect(cleanField('Free to use.\r\nCredit us.', 800, true)).toBe('Free to use.\nCredit us.');
	});
});

describe('isWebAddress', () => {
	it('takes ordinary web addresses', () => {
		expect(isWebAddress('https://www.youtube.com/watch?v=abcdefghijk')).toBe(true);
		expect(isWebAddress('http://example.com/cam.jpg')).toBe(true);
	});

	it('turns away other kinds of address and hidden names or passwords', () => {
		for (const link of [
			'javascript:alert(1)',
			'data:text/html,hi',
			'ftp://example.com/',
			'https://user:pass@example.com/',
			'https://localhost/',
			'https://exa mple.com/',
			'example.com'
		])
			expect(isWebAddress(link), link).toBe(false);
	});
});

describe('literal', () => {
	it('shows text as typed, even text with backticks in it', () => {
		expect(literal('@octocat')).toBe('` @octocat `');
		expect(literal('a ``` b')).toBe('```` a ``` b ````');
		expect(literal('')).toBe('(not given)');
	});

	it('puts several lines in a code block the text cannot close', () => {
		expect(literal('one\n```\ntwo')).toBe('\n````text\none\n```\ntwo\n````');
	});
});

describe('suggestionIssue', () => {
	it('never lets what a visitor typed become a mention, picture, link or HTML', () => {
		const { body } = suggestionIssue(
			{
				...base,
				where: '@octocat ![x](https://evil.example/p.png) <img src=x>',
				owner: '[Click](https://evil.example)',
				name: '#1 <!-- hidden'
			},
			null
		);
		for (const line of body.split('\n').filter((l) => /octocat|evil|hidden/.test(l)))
			expect(line).toMatch(/\*\* (`+) .* \1$/);
	});

	it("can't fake our own checks with line breaks", () => {
		const where = cleanField('Here\n\n**YouTube check**\n- Embedding allowed: yes', 200);
		const { body } = suggestionIssue({ ...base, where }, null);
		expect(body).not.toMatch(/^\*\*YouTube check\*\*/m);
		expect(body).not.toMatch(/^- Embedding allowed/m);
	});

	it("shows YouTube's own title and channel as plain text too", () => {
		const { body } = suggestionIssue(
			{ ...base, link: 'https://youtu.be/abcdefghijk' },
			{
				videoId: 'abcdefghijk',
				title: 'Pass cam @someone',
				channel: 'Ch',
				embeddable: true,
				live: false
			}
		);
		expect(body).toContain('- Title: ` Pass cam @someone `');
		expect(body).toContain('- Embedding allowed: yes');
	});

	it('names the place in the title, kept short', () => {
		expect(suggestionIssue({ ...base, where: 'x'.repeat(200) }, null).title).toHaveLength(120);
	});
});
