import { AboutStat, TestNotification } from "./InfoTabs";
import TabPage from "./TabPage";

export default function AboutTab() {
  return (
    <TabPage id="tabAbout" style={{paddingBottom: 80}}>
      {/* HERO INTRO */}
      <div className="about-card" style={{background: 'linear-gradient(135deg,#0a2540 0%,#1a3a5c 100%)', color: '#fff'}}>
        <h3 style={{color: '#fff', fontSize: '1.1rem', marginBottom: 8}}>Will It Sail? 🚢</h3>
        <p style={{color: 'rgba(255,255,255,.85)', fontSize: '.88rem', lineHeight: '1.65'}}>An unofficial sailing predictor for CalMac's west coast ferry network. It combines live weather forecasts, real CalMac cancellation history, live service status, and AIS vessel tracking to estimate how likely each sailing is to run — route by route, departure by departure.</p>
      </div>
      {/* LIVE STATS */}
      <div className="about-card">
        <h3>Database</h3>
        <div id="db-stats" style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12}}>
          <div style={{textAlign: 'center', background: 'var(--light)', borderRadius: 8, padding: 12}}>
            <AboutStat field="months" id="stat-months" />
            <div style={{fontSize: '.72rem', color: 'var(--muted)', marginTop: 2}}>Months of<br />real data</div>
          </div>
          <div style={{textAlign: 'center', background: 'var(--light)', borderRadius: 8, padding: 12}}>
            <AboutStat field="routes" id="stat-routes" />
            <div style={{fontSize: '.72rem', color: 'var(--muted)', marginTop: 2}}>Routes<br />calibrated</div>
          </div>
          <div style={{textAlign: 'center', background: 'var(--light)', borderRadius: 8, padding: 12}}>
            <div style={{fontSize: '1.6rem', fontWeight: 800, color: 'var(--navy)'}}>🟢</div>
            <div style={{fontSize: '.72rem', color: 'var(--muted)', marginTop: 2}}>Live CalMac<br />status API</div>
          </div>
        </div>
        <p style={{fontSize: '.78rem', color: 'var(--muted)'}}>Historical cancellation data comes from official CalMac monthly reliability PDFs at <a href="https://corporate.calmac.co.uk/en-gb/about-us/route-performance-reports/" target="_blank">corporate.calmac.co.uk</a>. Routes without PDF data use research-based estimates from Transport Scotland reports and FOI releases. The <strong>📊 Calibrated</strong> badge means a route's prediction is anchored to real cancellation history.</p>
      </div>
      {/* HOW IT WORKS */}
      <div className="about-card">
        <h3>How the prediction works</h3>
        <p style={{fontSize: '.85rem', color: 'var(--muted)', marginBottom: 14}}>Every route gets a <strong>Sailing Chance %</strong> calculated in three stages:</p>
        <div style={{display: 'flex', gap: 12, marginBottom: 16}}>
          <div style={{flexShrink: 0, width: 28, height: 28, borderRadius: '50%', background: 'var(--navy)', color: '#fff', fontWeight: 800, fontSize: '.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>1</div>
          <div>
            <div style={{fontWeight: 700, fontSize: '.9rem', color: 'var(--text)', marginBottom: 4}}>Weather risk score (0–100)</div>
            <p style={{fontSize: '.82rem', color: 'var(--muted)', margin: 0, lineHeight: '1.6'}}>Live data fetched from <a href="https://open-meteo.com" target="_blank" style={{color: 'var(--blue)', fontWeight: 600}}>Open-Meteo</a> every 30 minutes. Four conditions scored and summed:</p>
            <div style={{marginTop: 10}}>
              <div className="factor-row"><div className="factor-icon">💨</div><div className="factor-text"><div className="factor-name">Wind gusts &amp; direction</div><div className="factor-desc">Gust speed compared against each route's specific cancellation threshold — 40 mph for the exposed Stornoway crossing, 65 mph for the sheltered Gourock–Dunoon run. The score scales from 3 pts at 45% of threshold up to 40 pts when gusts exceed 120%. Wind direction (N/NE/E etc.) is also displayed on each card, averaged over the next 12 hours.</div></div><div className="factor-weight">0–40 pts</div></div>
              <div className="factor-row"><div className="factor-icon">🌊</div><div className="factor-text"><div className="factor-name">Wave height &amp; swell</div><div className="factor-desc">Significant wave height combined with swell period — long-period Atlantic swells are weighted more heavily than short wind chop at the same height. Threshold varies by route exposure (1 = sheltered, 4 = open ocean).</div></div><div className="factor-weight">0–30 pts</div></div>
              <div className="factor-row"><div className="factor-icon">🌫</div><div className="factor-text"><div className="factor-name">Visibility / fog</div><div className="factor-desc">CalMac can suspend sailings in fog independently of wind. 0 pts above 5 km, scaling to 15 pts in dense fog below 500 m.</div></div><div className="factor-weight">0–15 pts</div></div>
              <div className="factor-row" style={{borderBottom: 'none'}}><div className="factor-icon">🌧</div><div className="factor-text"><div className="factor-name">Precipitation &amp; snow</div><div className="factor-desc">Heavy rain adds 2 pts, heavy snow adds 5 pts, and blizzard conditions (WMO code ≥ 71) add the full 10 pts. Accounts for port access and loading difficulties.</div></div><div className="factor-weight">0–10 pts</div></div>
            </div>
            <p style={{fontSize: '.78rem', color: 'var(--muted)', marginTop: 10, background: 'var(--light)', borderRadius: 8, padding: 8}}>The <strong>overall route score</strong> is the average of the three worst hours in the next 12 — so one gusty hour doesn't tank a mostly calm day. Each individual <strong>sailing row</strong> shows that departure's specific hour score.</p>
          </div>
        </div>
        <div style={{display: 'flex', gap: 12, marginBottom: 16}}>
          <div style={{flexShrink: 0, width: 28, height: 28, borderRadius: '50%', background: 'var(--navy)', color: '#fff', fontWeight: 800, fontSize: '.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>2</div>
          <div>
            <div style={{fontWeight: 700, fontSize: '.9rem', color: 'var(--text)', marginBottom: 4}}>Season &amp; route adjustments</div>
            <ul style={{fontSize: '.82rem', color: 'var(--muted)', margin: '6px 0 0 0', paddingLeft: 18, lineHeight: '1.7'}}>
              <li><strong>Season factor</strong> — cancellation thresholds are 15% stricter in winter (Nov–Feb), 7% stricter in shoulder months (Mar, Sep, Oct), and standard in summer (Apr–Aug). This reflects CalMac's real-world higher cancellation rates in winter.</li>
              <li><strong>Route exposure profile</strong> — each of the 22 routes has a wind threshold (mph), wave threshold, and exposure rating built from route geography and historical cancellation data.</li>
              <li><strong>Tidal penalty</strong> — a small fixed penalty for routes with known tidal constraints (Uig triangle, Small Isles) that can cause cancellations independently of weather.</li>
            </ul>
          </div>
        </div>
        <div style={{display: 'flex', gap: 12}}>
          <div style={{flexShrink: 0, width: 28, height: 28, borderRadius: '50%', background: 'var(--navy)', color: '#fff', fontWeight: 800, fontSize: '.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>3</div>
          <div>
            <div style={{fontWeight: 700, fontSize: '.9rem', color: 'var(--text)', marginBottom: 4}}>Historical calibration blend</div>
            <p style={{fontSize: '.82rem', color: 'var(--muted)', margin: 0, lineHeight: '1.6'}}>For routes with a 📊 Calibrated badge, the weather score is blended with real CalMac reliability data — seasonal figures from official monthly performance PDFs:</p>
            <div style={{background: 'var(--light)', borderRadius: 8, padding: '10px 12px', marginTop: 8, fontFamily: 'monospace', fontSize: '.8rem', color: 'var(--navy)'}}>final = (weather × 0.7) + (history × 0.3)</div>
            <p style={{fontSize: '.78rem', color: 'var(--muted)', marginTop: 8, lineHeight: '1.6'}}>The result is capped at that route's historical reliability + 10% — so even in perfect weather, a structurally unreliable route can't show an unrealistically high score. The 📊 Calibrated badge only appears when the historical data shifts the final score by more than 3%, so it's a genuine signal rather than a label on every route. Routes without PDF data use weather-only predictions.</p>
          </div>
        </div>
      </div>
      {/* NEW FEATURES */}
      <div className="about-card">
        <h3>Features</h3>
        {/* Live service status */}
        <div style={{marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--light)'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6}}>
            <span style={{fontSize: '1.1rem'}}>🚨</span>
            <span style={{fontWeight: 700, fontSize: '.9rem', color: 'var(--text)'}}>Live CalMac service status</span>
          </div>
          <p style={{fontSize: '.83rem', color: 'var(--muted)', lineHeight: '1.6', margin: 0}}>Pulled automatically from CalMac's internal service status API every 10 minutes. Affected route cards are flagged with a status pill — 🚨 Cancelled, ⚠️ Disrupted, or ⚠️ Be Aware — and individual sailing rows show the disruption reason (Weather, Technical, Operational). When all sailings on a route are cancelled, the card shows ❌ and "Cancelled" instead of a percentage. Routes with an upcoming status change show an ⏰ pill even before the disruption starts.</p>
        </div>
        {/* Tomorrow toggle */}
        <div style={{marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--light)'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6}}>
            <span style={{fontSize: '1.1rem'}}>📅</span>
            <span style={{fontWeight: 700, fontSize: '.9rem', color: 'var(--text)'}}>Tomorrow's forecast</span>
          </div>
          <p style={{fontSize: '.83rem', color: 'var(--muted)', lineHeight: '1.6', margin: 0}}>The Tomorrow button in the toolbar switches every route card to show the next day's sailing chances, gust and wave figures, and a full timetable with per-sailing risk scores for tomorrow. Tap it again to return to today's view.</p>
        </div>
        {/* Smart notifications */}
        <div style={{marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--light)'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6}}>
            <span style={{fontSize: '1.1rem'}}>🔔</span>
            <span style={{fontWeight: 700, fontSize: '.9rem', color: 'var(--text)'}}>Smart route notifications</span>
          </div>
          <p style={{fontSize: '.83rem', color: 'var(--muted)', lineHeight: '1.6', margin: 0}}>Tap <strong>Alert me</strong> on any route to subscribe to push notifications. A slider lets you set your own alert threshold per route — anywhere from 30% to 90% — so you can choose exactly how sensitive the alert is. The notification fires when the sailing chance drops below your threshold, with a 2-hour cooldown per route to avoid spam. Works on Chrome, Edge, Firefox, and Safari on iOS 16.4+ when added to your home screen.</p>
          <TestNotification />
        </div>
        {/* Wind direction */}
        <div style={{marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--light)'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6}}>
            <span style={{fontSize: '1.1rem'}}>🌬️</span>
            <span style={{fontWeight: 700, fontSize: '.9rem', color: 'var(--text)'}}>Wind direction</span>
          </div>
          <p style={{fontSize: '.83rem', color: 'var(--muted)', lineHeight: '1.6', margin: 0}}>Each route card now shows the dominant wind direction alongside gust speed — for example "47 mph SW". Direction is averaged over the next 12 hours and shown as a compass bearing (N, NE, E, SE, S, SW, W, NW).</p>
        </div>
        {/* Sunrise awareness */}
        <div style={{marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--light)'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6}}>
            <span style={{fontSize: '1.1rem'}}>🌙</span>
            <span style={{fontWeight: 700, fontSize: '.9rem', color: 'var(--text)'}}>Pre-dawn sailing flag</span>
          </div>
          <p style={{fontSize: '.83rem', color: 'var(--muted)', lineHeight: '1.6', margin: 0}}>Early departures that are scheduled before sunrise are flagged with "🌙 Pre-dawn · Next" on the Next sailing pill. Sunrise and sunset are calculated from each route's latitude and longitude, accounting for the season and UK timezone offset.</p>
        </div>
        {/* Share links */}
        <div style={{marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--light)'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6}}>
            <span style={{fontSize: '1.1rem'}}>🔗</span>
            <span style={{fontWeight: 700, fontSize: '.9rem', color: 'var(--text)'}}>Share links</span>
          </div>
          <p style={{fontSize: '.83rem', color: 'var(--muted)', lineHeight: '1.6', margin: 0}}>Every route card has a Share button. Tap it, enter your name, and a unique link is generated. On iOS and Android it opens the native share sheet; on desktop it copies the link to clipboard. When the recipient opens the link it shows your name at the top — <em>"Ross shared Ardrossan – Brodick with you 🚢"</em> — and opens directly to that route.</p>
        </div>
        {/* Live vessel */}
        <div style={{marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--light)'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6}}>
            <span style={{fontSize: '1.1rem'}}>🚢</span>
            <span style={{fontWeight: 700, fontSize: '.9rem', color: 'var(--text)'}}>Live vessel identification</span>
          </div>
          <p style={{fontSize: '.83rem', color: 'var(--muted)', lineHeight: '1.6', margin: 0}}>The route detail modal shows the vessel currently operating that route, fetched live from AIS position data via aisstream.io. If a vessel is detected within the route's geographic bounding box it's shown with a green live indicator. If AIS data is unavailable, the scheduled vessel for that route is shown instead.</p>
        </div>
        {/* Route info cards */}
        <div style={{marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--light)'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6}}>
            <span style={{fontSize: '1.1rem'}}>ℹ️</span>
            <span style={{fontWeight: 700, fontSize: '.9rem', color: 'var(--text)'}}>Route info &amp; next sailing</span>
          </div>
          <p style={{fontSize: '.83rem', color: 'var(--muted)', lineHeight: '1.6', margin: 0}}>The detail modal shows crossing time, service type, scheduled vessel, and a contextual note per route. On the card itself, the next upcoming departure is highlighted with a blue border and "Next sailing" label (or "🌙 Pre-dawn · Next" for early departures). Past sailings are faded. Routes without a published timetable show a link to calmac.co.uk instead.</p>
        </div>
        {/* Status tab */}
        <div style={{marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--light)'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6}}>
            <span style={{fontSize: '1.1rem'}}>📡</span>
            <span style={{fontWeight: 700, fontSize: '.9rem', color: 'var(--text)'}}>System status page</span>
          </div>
          <p style={{fontSize: '.83rem', color: 'var(--muted)', lineHeight: '1.6', margin: 0}}>The Status tab gives a live health check of every data source: Weather API, Marine/Wave API, CalMac Status API (including when disruption data was last fetched), Push Notifications, Service Worker, and Historical Calibration. Each shows a green/amber/red indicator with a detail line. Tap "Check now" to re-run all checks.</p>
        </div>
        {/* Offline / PWA */}
        <div>
          <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6}}>
            <span style={{fontSize: '1.1rem'}}>📱</span>
            <span style={{fontWeight: 700, fontSize: '.9rem', color: 'var(--text)'}}>Offline support &amp; installable (PWA)</span>
          </div>
          <p style={{fontSize: '.83rem', color: 'var(--muted)', lineHeight: '1.6', margin: 0}}>A service worker caches the app shell so it remains usable in areas with no signal — useful in remote ferry terminals. When offline, a banner shows the time data was last loaded. On supported browsers (Chrome, Edge on Android) a prompt offers to install the app to your home screen for faster access. On iOS, add it via Safari's Share → Add to Home Screen.</p>
        </div>
      </div>
      {/* PER-SAILING */}
      <div className="about-card">
        <h3>Individual sailing predictions</h3>
        <p style={{fontSize: '.85rem', color: 'var(--muted)', lineHeight: '1.65'}}>Each route card shows a timetable where every departure has its own sailing chance, re-calculated for that specific hour. A route might show 90% overall but flag a 15:00 departure at 65% if a squall is forecast that afternoon.</p>
        <p style={{fontSize: '.85rem', color: 'var(--muted)', lineHeight: '1.65', marginTop: 8}}>The <strong>next upcoming sailing</strong> is highlighted with a blue border. Cancelled sailings show in red with a strikethrough direction; disrupted sailings show in amber with the disruption reason (e.g. 🔧 Technical, 🌊 Weather). Use the <strong>Tomorrow</strong> button in the toolbar to switch all cards to the following day's timetable and risk scores.</p>
        <p style={{fontSize: '.85rem', color: 'var(--muted)', lineHeight: '1.65', marginTop: 8}}>Sailing times are loaded live from CalMac's own schedule for the exact day shown, so seasonal timetable changes and route diversions are picked up automatically. If the live schedule can't be reached, a built-in summer 2026 timetable is shown instead.</p>
      </div>
      {/* DATA SOURCES */}
      <div className="about-card">
        <h3>Data sources</h3>
        <div className="factor-row"><div className="factor-icon">🌤</div><div className="factor-text"><div className="factor-name">Open-Meteo</div><div className="factor-desc">Free, open-source weather API. Provides 48 hours of hourly wind speed, gusts, direction, wave height, swell, visibility and precipitation forecasts at each route's midpoint coordinates. Auto-refreshed every 30 minutes.</div></div></div>
        <div className="factor-row"><div className="factor-icon">🚨</div><div className="factor-text"><div className="factor-name">CalMac service status API</div><div className="factor-desc">CalMac's own internal GraphQL endpoint, polled automatically on load and every 10 minutes. Returns per-route disruption status, reason, and whether a change is imminent. Falls back to a link to the official status page if unavailable.</div></div></div>
        <div className="factor-row"><div className="factor-icon">🛳</div><div className="factor-text"><div className="factor-name">AIS vessel tracking (aisstream.io)</div><div className="factor-desc">Live vessel position data from AIS receivers. Used to identify which vessel is currently operating each route, updated when you open a route's detail view.</div></div></div>
        <div className="factor-row"><div className="factor-icon">📋</div><div className="factor-text"><div className="factor-name">CalMac Reliability PDFs</div><div className="factor-desc">Official monthly performance reports from CalMac's corporate site. Each PDF contains month-by-month operated and cancelled sailing counts. Six routes are currently fully calibrated (72 months of verified data).</div></div></div>
        <div className="factor-row" style={{borderBottom: 'none'}}><div className="factor-icon">🗂</div><div className="factor-text"><div className="factor-name">Transport Scotland / FOI data</div><div className="factor-desc">For routes where CalMac PDFs aren't yet in the database, estimates come from Transport Scotland annual reports and published FOI responses.</div></div></div>
      </div>
      {/* LIMITATIONS */}
      <div className="about-card">
        <h3>Limitations &amp; honest caveats</h3>
        <ul style={{fontSize: '.84rem', color: 'var(--muted)', paddingLeft: 18, lineHeight: '1.85', margin: 0}}>
          <li><strong>Not all cancellations are weather-related.</strong> Mechanical breakdowns, crewing issues and port problems cause a significant proportion of cancellations. The live CalMac status API catches many of these — but only when CalMac has already published an alert. Surprise failures won't appear until CalMac posts them.</li>
          <li><strong>The forecast grid may miss local conditions.</strong> The Minch, Sound of Mull and Firth of Lorn can have sea states that differ significantly from the nearest Open-Meteo grid point.</li>
          <li><strong>CalMac masters have the final say.</strong> Internal safety thresholds aren't published — our thresholds are reverse-engineered from cancellation history and will never be perfectly calibrated.</li>
          <li><strong>Tidal routes are especially uncertain.</strong> Operational constraints at some piers go beyond weather alone and aren't fully captured in the model.</li>
          <li><strong>AIS coverage has gaps.</strong> Some areas have limited AIS receiver coverage. The vessel shown may be delayed or missing if the vessel is out of range of a receiver.</li>
          <li><strong>Historical data quality varies.</strong> Six routes have full verified PDF data; the rest use estimates which are less precise — particularly in winter months where disruption patterns are harder to model.</li>
        </ul>
      </div>
      {/* DISCLAIMER */}
      <div className="about-card" style={{border: '2px solid #f0a500', background: '#fffbf0'}}>
        <h3 style={{color: '#b47a00'}}>⚠️ Disclaimer</h3>
        <p style={{fontSize: '.85rem', color: '#7a5500', lineHeight: '1.65'}}>This is an <strong>unofficial</strong> community tool with no affiliation to Caledonian MacBrayne. Predictions are estimates only — always check <a href="https://www.calmac.co.uk/service-status" target="_blank" style={{color: '#b47a00', fontWeight: 600}}>CalMac's official service status</a> before travelling. Never rely solely on this app for travel decisions.</p>
      </div>
      {/* DEVELOPER */}
      <div className="about-card" style={{textAlign: 'center'}}>
        <h3>Developer</h3>
        <p style={{marginBottom: 6}}>Built by <strong style={{color: 'var(--navy)'}}>Ross Mackenzie</strong></p>
        <p style={{fontSize: '.78rem', color: 'var(--muted)'}}>Inverness, Scotland 🏴󠁧󠁢󠁳󠁣󠁴󠁿</p>
        <p style={{fontSize: '.78rem', color: 'var(--muted)', marginTop: 8}}>Sailing times from CalMac's live schedule. Always verify at <a href="https://www.calmac.co.uk/timetables" target="_blank">calmac.co.uk</a>.</p>
      </div>
    </TabPage>
  );
}
