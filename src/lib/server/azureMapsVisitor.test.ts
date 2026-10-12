import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./mapsBudget', () => ({ takeMapsRequest: () => true }));

const { azureRoute } = await import('./azureMaps');
const { withVisitor } = await import('./visitor');

const route = {
	routes: [
		{
			summary: { lengthInMeters: 1609, travelTimeInSeconds: 60 },
			legs: [
				{
					points: [
						{ latitude: 47, longitude: -122 },
						{ latitude: 47.01, longitude: -122 }
					]
				}
			]
		}
	]
};
const stops = [
	{ lat: 47, lon: -122 },
	{ lat: 47.01, lon: -122 }
];

describe('Azure Maps per visitor', () => {
	beforeEach(() => {
		process.env.AZURE_MAPS_KEY = 'test';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(route)))
		);
	});
	afterEach(() => {
		delete process.env.AZURE_MAPS_KEY;
		vi.unstubAllGlobals();
	});

	it('stops one visitor after their hourly share, without stopping anyone else', async () => {
		for (let i = 0; i < 10; i++) await withVisitor('203.0.113.9', () => azureRoute(stops));
		await expect(withVisitor('203.0.113.9', () => azureRoute(stops))).rejects.toThrow();
		await expect(withVisitor('198.51.100.4', () => azureRoute(stops))).resolves.toBeTruthy();
	});
});
