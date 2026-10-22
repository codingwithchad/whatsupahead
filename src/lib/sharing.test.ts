import { describe, expect, it } from 'vitest';
import {
	creditLine,
	creditSentence,
	credits,
	previewCredit,
	sentence,
	tripShareParams
} from './sharing';

const cam = (over: Record<string, unknown> = {}) => ({
	source: 'WSDOT',
	attribution_text: 'Washington State Department of Transportation',
	feed_type: 'image' as const,
	feed_url: 'https://images.wsdot.wa.gov/sc/090VC05200.jpg',
	...over
});

describe('previewCredit', () => {
	it('allows public agency and public domain pictures, with a short credit', () => {
		// WSDOT's own wording (2026-10-13).
		expect(previewCredit(cam())).toBe('Camera courtesy of WSDOT');
		expect(previewCredit(cam({ source: 'Caltrans' }))).toBe('Caltrans');
		expect(previewCredit(cam({ source: 'ODOT' }))).toBe('ODOT TripCheck');
		expect(previewCredit(cam({ source: 'National Park Service' }))).toBe('National Park Service');
		expect(previewCredit(cam({ source: 'NDOT' }))).toBe('NDOT Nevada 511');
		// Boise's city cameras come through Idaho 511 but are not ITD's.
		expect(
			previewCredit(
				cam({ source: 'ACHD', attribution_text: 'Ada County Highway District, via Idaho 511' })
			)
		).toBeNull();
	});
	it('never uses Windy, video, cameras passed on for someone else, or unlisted owners', () => {
		expect(previewCredit(cam({ provider: 'windy', source: 'KING 5 via Windy.com' }))).toBeNull();
		expect(previewCredit(cam({ source: 'WSDOT', provider: 'windy' }))).toBeNull();
		expect(previewCredit(cam({ feed_type: 'stream' }))).toBeNull();
		expect(previewCredit(cam({ attribution_text: 'Whidbey Telecom, via WSDOT' }))).toBeNull();
		expect(previewCredit(cam({ source: 'Mt. Spokane' }))).toBeNull();
		expect(previewCredit(cam({ source: 'WSDOT Aviation' }))).toBeNull();
		expect(previewCredit(cam({ feed_url: undefined }))).toBeNull();
	});
	it('lists each credit once', () => {
		expect(credits(['WSDOT', null, 'Caltrans', 'WSDOT'])).toBe('WSDOT, Caltrans');
	});

	it("prints an owner's own credit sentence as it is", () => {
		expect(creditLine(['Caltrans', null, 'Caltrans'], 2)).toBe('Pictures: Caltrans');
		expect(creditLine(['Camera courtesy of WSDOT'], 1)).toBe('Camera courtesy of WSDOT');
		expect(creditLine(['Camera courtesy of WSDOT', 'ODOT TripCheck'], 2)).toBe(
			'Pictures: ODOT TripCheck · Camera courtesy of WSDOT'
		);
		expect(creditLine([], 0)).toBe('');
		expect(creditSentence({ source: 'WSDOT', attribution_text: 'Camera courtesy of WSDOT' })).toBe(
			'Camera courtesy of WSDOT.'
		);
		expect(creditSentence({ source: 'Caltrans' })).toBe('From Caltrans.');
	});
});

describe('tripShareParams', () => {
	it('keeps the drive and drops personal choices', () => {
		const p = new URLSearchParams(
			'from=Everett&to=Leavenworth&in=60&all=1&demo=winter&via=47.1,-120.9'
		);
		expect(tripShareParams(p).toString()).toBe('from=Everett&to=Leavenworth&via=47.1%2C-120.9');
	});
});

describe('sentence', () => {
	it('adds a full stop only when needed', () => {
		expect(sentence('Terminal cameras and sailing space')).toBe(
			'Terminal cameras and sailing space.'
		);
		expect(sentence('Open all year.')).toBe('Open all year.');
	});
});

describe('tripShareParams after planning again from where you are', () => {
	it('shares the original start, never your position', () => {
		const p = new URLSearchParams(
			'from=47.9310,-122.2052&fl=Your+location&of=Seattle&ofl=Seattle,+WA&to=Leavenworth&in=60'
		);
		expect(Object.fromEntries(tripShareParams(p))).toEqual({
			from: 'Seattle',
			fl: 'Seattle, WA',
			to: 'Leavenworth'
		});
	});
});
