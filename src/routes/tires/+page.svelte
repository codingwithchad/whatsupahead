<script lang="ts">
	import { APP_NAME } from '../../lib/brand';
</script>

<svelte:head>
	<title>What's a Traction Tire? Chains and Tires for Mountain Passes · {APP_NAME}</title>
</svelte:head>

<header class="top">
	<a class="brand" href="/">{APP_NAME}</a>
	<span class="top-title">Tires and chains</span>
</header>

<main class="about tires">
	<h1>What's a traction tire?</h1>
	<p class="lede-dark">
		The sign at the bottom of the pass says "Traction tires required". Do you have them? Here is how
		to check in two minutes, and what each sign means for your car.
	</p>

	<h2>Check your tires</h2>
	<div class="tire-checks">
		<section class="tire-check">
			<h3>1. Look at the side of the tire</h3>
			<p>Find one of these, usually in small letters near the size (like 215/60R16):</p>
			<ul>
				<li><strong>M+S</strong>, M/S or "Mud and Snow". Most all-season tires have it.</li>
				<li>
					<span class="snowflake" aria-hidden="true">
						<svg viewBox="0 0 48 40" width="40" height="34">
							<path
								d="M2 38 L16 10 L24 22 L31 6 L46 38 Z"
								fill="none"
								stroke="currentColor"
								stroke-width="3"
								stroke-linejoin="round"
							/>
							<g stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
								<path d="M28 20 V34" /><path d="M22 27 H34" /><path
									d="M23.8 22.8 L32.2 31.2"
								/><path d="M32.2 22.8 L23.8 31.2" />
							</g>
						</svg>
					</span>
					<strong>The mountain and snowflake</strong>: three peaks with a snowflake inside. Winter
					tires and some all-weather tires have it. It means the tire passed a snow test.
				</li>
			</ul>
		</section>
		<section class="tire-check">
			<h3>2. Check the tread</h3>
			<p>
				Push a quarter upside down into the groove in the middle of the tire. If you can see the top
				of Washington's head, the tread is under 1/8 inch (4/32), and in Washington it no longer
				counts as a traction tire. Worn tires slide on snow whatever the side says.
			</p>
		</section>
		<section class="tire-check">
			<h3>3. Know what drives your wheels</h3>
			<p>
				AWD or 4WD is on the back of many cars and in the owner's manual. It helps you get going,
				not stop: it is not a traction tire, and it doesn't replace one. If you use chains, they go
				on the wheels that drive the car (the front on most cars). On an AWD, the manual says which.
			</p>
		</section>
	</div>

	<h2>What the signs mean</h2>
	<p>
		Each state words its signs a little differently. On every pass page, <strong
			>Chains today</strong
		>
		turns the current sign into one answer for a car, an AWD or 4WD, and a vehicle that is towing or over
		10,000 lb.
	</p>

	<section class="state-rules">
		<h3>Washington</h3>
		<ul>
			<li>
				<strong>Traction tires advised</strong>: nothing is required yet. Carry chains and slow
				down.
			</li>
			<li>
				<strong>Traction tires required</strong>: every vehicle needs traction tires, which in
				Washington means M+S or the mountain and snowflake, with at least 1/8 inch of tread. Studded
				tires count. If yours don't qualify, put chains on.
			</li>
			<li>
				<strong>Chains required on all vehicles except all-wheel drive</strong>: cars and trucks
				chain up. AWD and 4WD (in four-wheel drive) may go on with traction tires, and must carry
				chains.
			</li>
			<li>
				<strong>Chains required on all vehicles</strong>: everyone, AWD included. Studded tires
				don't replace chains.
			</li>
		</ul>
		<p class="tire-fine">
			Ignoring a chain sign is a $500 ticket in Washington. Studded tires are legal November 1 to
			March 31. <a
				href="https://wsdot.com/travel/real-time/mountainpasses/tiresandchains"
				target="_blank"
				rel="noopener">WSDOT tires and chains</a
			>
		</p>
	</section>

	<section class="state-rules">
		<h3>Oregon</h3>
		<p>
			In Oregon, "traction tires" means tires with the mountain and snowflake, or studded tires. M+S
			on its own is not enough.
		</p>
		<ul>
			<li>
				<strong>Carry chains or traction tires</strong>: you must have chains in the car, or
				traction tires on it.
			</li>
			<li>
				<strong>Chains required on vehicles towing or over 10,000 GVW</strong>: chains for trailers
				and big trucks. Everyone else carries chains or has traction tires.
			</li>
			<li>
				<strong>Chains required, traction tires allowed in place of chains</strong>: a car that
				isn't towing may use traction tires instead of chains. Towing or over 10,000 lb: chains.
			</li>
			<li>
				<strong>AWD and 4WD</strong> may skip chains when they weigh 6,500 lb or less unloaded, drive
				all four wheels, carry chains, have M+S, all-weather or traction tires on every wheel, and aren't
				towing. In the worst storms ODOT can still require chains on everyone.
			</li>
		</ul>
		<p class="tire-fine">
			Studded tires are legal November 1 to March 31. <a
				href="https://www.tripcheck.com/Pages/Chain-Law"
				target="_blank"
				rel="noopener">ODOT chain law</a
			>
		</p>
	</section>

	<section class="state-rules">
		<h3>California</h3>
		<p>California posts three levels at chain control checkpoints, where crews check every car.</p>
		<ul>
			<li>
				<strong>R-1</strong>: chains, unless your car or light truck has snow tires (M+S) on at
				least the two wheels that drive it. Carry chains anyway. Towing: chains.
			</li>
			<li>
				<strong>R-2</strong>: chains on everything, except AWD and 4WD with snow tires on all four
				wheels. They must carry chains.
			</li>
			<li>
				<strong>R-3</strong>: chains on every vehicle, no exceptions. Usually the step before
				closing.
			</li>
		</ul>
		<p class="tire-fine">
			Chain installers at the checkpoints are independent businesses: agree on the price first and
			get a receipt. They can't sell or rent chains, so bring your own. Speed with chains: 25 or 30
			mph. <a
				href="https://dot.ca.gov/travel/winter-driving-tips/chain-controls"
				target="_blank"
				rel="noopener">Caltrans chain controls</a
			>
		</p>
	</section>

	<h2>Chains, if you've never used them</h2>
	<ul>
		<li>
			<strong>Buy them before the trip.</strong> The size is printed on the tire (like 215/60R16). Stores
			near the pass sell out, or charge more, on the first snowy weekend.
		</li>
		<li>
			<strong>Practice once at home</strong>, in dry weather, with gloves on. It is much harder the
			first time in the dark and slush.
		</li>
		<li>
			<strong>Put them on at the chain-up area, before the road looks bad.</strong> The rule starts where
			the sign is because the road can go from bare to ice within a mile, and a car that stops to chain
			up in a lane blocks everyone.
		</li>
		<li>
			<strong>Go slow with chains on</strong> (25 to 30 mph), and take them off at the chain-off area
			so they don't break on bare road.
		</li>
	</ul>

	<h2>Before you leave</h2>
	<ul>
		<li>
			Look at the pass page for the report, the cameras and the forecast, then look again on the
			way.
		</li>
		<li>Full tank, warm clothes, gloves, water, snacks, a flashlight and a charged phone.</li>
		<li>
			If the pass is closed, wait or take the route the state names. Don't follow a phone map's
			detour onto side roads or forest roads: they aren't plowed.
		</li>
	</ul>
	<p><a class="button" href="/passes">Mountain passes right now</a></p>

	<p class="tire-fine">
		Written from the states' own rules (WSDOT, ODOT, Caltrans) in October 2026. Rules change, and
		the signs on the road always come first.
	</p>
</main>
