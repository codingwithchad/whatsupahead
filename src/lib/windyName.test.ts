import { describe, expect, it } from 'vitest';
import { tidyWindyName } from './windyName.js';

describe('tidyWindyName', () => {
	it('leads with what the camera looks at', () => {
		expect(tidyWindyName('Incline Village – North-west: Mt. Rose - Ski Tahoe')).toBe(
			'Mt. Rose - Ski Tahoe (Incline Village, looking north-west)'
		);
		expect(tidyWindyName('Incline Village: Diamond Peak Ski Resort, Nevada (USA)')).toBe(
			'Diamond Peak Ski Resort (Incline Village)'
		);
		expect(tidyWindyName('Redondo Beach – West: California, United States: Topaz Jetty')).toBe(
			'Topaz Jetty (Redondo Beach, looking west)'
		);
	});

	it('keeps a town alone, and says which way it looks', () => {
		expect(tidyWindyName('Bend – West')).toBe('Bend, looking west');
		expect(tidyWindyName('Portland')).toBe('Portland');
		expect(tidyWindyName('Belvedere – South-west: California, United States')).toBe(
			'Belvedere, looking south-west'
		);
	});

	it("doesn't repeat a town the view already names", () => {
		expect(tidyWindyName('Portland – East: Portland Airport')).toBe(
			'Portland Airport (looking east)'
		);
	});
});
