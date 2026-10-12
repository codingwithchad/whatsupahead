import { describe, expect, it } from 'vitest';
import { credits, previewCredit, sentence, tripShareParams } from './sharing';

const cam = (over: Record<string, unknown> = {}) => ({
	source: 'WSDOT',
	attribution_text: 'Washington State Department of Transportation',
	feed_type: 'image' as const,
	feed_url: 'https://images.wsdot.wa.gov/sc/090VC05200.jpg',
	...over
});

describe('previewCredit', () => {
	it('allows public agency and public domain pictures, with a short credit', () => {
		expect(previewCredit(cam())).toBe('WSDOT');
		expect(previewCredit(cam({ source: 'Caltrans' }))).toBe('Caltrans');
		expect(previewCredit(cam({ source: 'ODOT' }))).toBe('ODOT TripCheck');
		expect(previewCredit(cam({ source: 'National Park Service' }))).toBe('National Park Service');
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
