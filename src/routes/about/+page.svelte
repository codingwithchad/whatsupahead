<script lang="ts">
	import { APP_NAME, COVERAGE, REPO_URL, TAGLINE } from '../../lib/brand';
</script>

<svelte:head><title>About · {APP_NAME}</title></svelte:head>

<header class="top">
	<a class="brand" href="/">{APP_NAME}</a>
	<span class="top-title">About</span>
</header>

<main class="about">
	<h1>About {APP_NAME}</h1>
	<p class="lede-dark">{TAGLINE}</p>

	<h2>What it is</h2>
	<p>
		You enter a place, or a start and a finish, and it shows the public cameras, the weather and the
		waits along the way: snow on a mountain pass, the ferry line, the border, a commute home.
		Cameras appear in the order you'll pass them, with the forecast for when you'll get there. It
		covers the West Coast: {COVERAGE}.
	</p>

	<h2>Where the information comes from</h2>
	<ul>
		<li>
			Routes and place search: <a
				href="https://azure.microsoft.com/products/azure-maps"
				target="_blank"
				rel="noopener">Microsoft Azure Maps</a
			>, with live traffic, and map data from
			<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener"
				>OpenStreetMap contributors</a
			>, through the open-source
			<a href="https://project-osrm.org/" target="_blank" rel="noopener">OSRM</a> routing service and
			Nominatim and Photon (by Komoot), and town and ZIP locations from the US Census Bureau. The app
			uses a route only as a line on the map to find the cameras along it; it doesn't give turn-by-turn
			directions.
		</li>
		<li>
			Cameras and road reports: the Washington State Department of Transportation (WSDOT), WSDOT
			Aviation, the Oregon Department of Transportation (TripCheck), the California Department of
			Transportation (Caltrans) and the National Park Service.
		</li>
		<li>
			Weather, rivers, tides and flights: the National Weather Service, NOAA, USGS and the FAA.
			Weather on the way and snow along a drive: Azure Maps weather and
			<a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0).
		</li>
		<li>
			Some cameras, such as ski areas and viewpoints, come through <a
				href="https://www.windy.com/"
				target="_blank"
				rel="noopener">Windy.com</a
			>, which is credited wherever they appear.
		</li>
	</ul>
	<p>
		We only show cameras their owners publish for public use. The full list, and the rule for adding
		more, is on
		<a href="{REPO_URL}/blob/main/docs/sources.md" target="_blank" rel="noopener"
			>the sources page</a
		>.
	</p>

	<h2>Your privacy</h2>
	<p>
		There are no accounts, no ads and no tracking. Your recent places and saved choices stay on your
		own phone. If you press "Use my location" or "Follow my trip", your location is used to find
		places and cameras near you and is not stored. Like any website, the host's server logs may
		briefly record ordinary request details.
	</p>
	<p>
		To learn which parts are useful, the site counts page views and a few taps (like "Next" in the
		camera viewer), and roughly how many different people visit each day. It uses no cookies and
		keeps nothing about who you are: to tell visits apart for one day, the server scrambles your
		network address and browser name with a random value that changes daily and is never saved. It
		never records what you type into search.
	</p>

	<h2>Please note</h2>
	<p>
		This is an independent project and is <strong
			>not affiliated with WSDOT, ODOT or any agency</strong
		>. Pictures can be late, frozen or missing, and road conditions change quickly. Always check the
		official source (for passes,
		<a href="https://wsdot.com/travel/real-time/mountainpasses" target="_blank" rel="noopener"
			>WSDOT's pass page</a
		>) before you travel, and don't use your phone while driving.
	</p>

	<h2>Oregon road cameras</h2>
	<p>
		Oregon road camera pictures are provided by the Oregon Department of Transportation and its
		partner agencies through the
		<a href="https://tripcheck.com/" target="_blank" rel="noopener">TripCheck</a> Data API. We show our
		own copy of each picture, refreshed every few minutes. ODOT's disclaimer:
	</p>
	<blockquote class="disclaimer">
		ODOT and public agencies providing the data on this portal attempt to provide the best service
		reasonably available, but situations will occur that disrupt service. The updating and
		dissemination of this information depends on a number of available resources, including Internet
		availability, communications networks, and interconnected computer systems which may be beyond
		the immediate control of ODOT. Availability at any given time is not guaranteed. Those relying
		on information presented on this site do so at their own risk, and the State of Oregon, ODOT,
		and the public agencies providing the data, and any of their officers, employees or agents shall
		be held harmless and released from liability for the accuracy or completeness of this
		information and from any actions taken based on the information. All information is provided "as
		is" without warranty of any kind, either express or implied, including, but not limited to, the
		implied warranties of merchantability, fitness for a particular purpose, or non-infringement.
		ODOT assumes no responsibility for errors or omissions in the information or software or other
		documents which are referenced by or linked to this portal. Under no circumstances, including,
		but not limited to, negligence, shall ODOT or any public agency contributing data to this portal
		be liable for any direct, indirect, incidental, special or consequential damages that result
		from the use of, or the inability to use, this portal or its content.
	</blockquote>

	<h2>Who made it</h2>
	<p>
		One person, with voice dictation and <a
			href="https://claude.com/claude-code"
			target="_blank"
			rel="noopener">Claude Code</a
		>. It's open source (MIT license) and other people are welcome to help:
		<a href={REPO_URL} target="_blank" rel="noopener"
			>the code and a list of starter tasks are on GitHub</a
		>. Found a dead camera or a mistake?
		<a href="{REPO_URL}/issues/new/choose" target="_blank" rel="noopener">Tell us</a>.
	</p>
</main>
