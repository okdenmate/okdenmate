/**
 * Widget styles.
 *
 * These live inside a shadow root, so the host page's stylesheet cannot reach
 * in and this cannot leak out. That matters more than it sounds: a form
 * dropped into an unknown CMS theme is otherwise at the mercy of whatever
 * `input { }` rule that theme happens to carry.
 *
 * Two profiles, matching the application, so the site-side form carries
 * whichever identity is chosen rather than a third one. Each has a light
 * variant for a page not ready to run a dark panel, and in every case the
 * accent was checked against its own ground rather than assumed to carry over.
 */

export const CSS = `
/* --- Profile: ukn (default) ---
 * Cold ground, chemical accent. Measured against the ground: text 16.3:1,
 * secondary 7.5:1, accent 11.5:1, dark ink on the accent 10.4:1.
 */
:host {
  --bg: #0c110e;
  --panel: rgba(233,239,234,.05);
  --panel-2: rgba(233,239,234,.085);
  --line: rgba(233,239,234,.16);
  --text: #e9efea;
  --text-2: #95a69b;
  --text-3: #76877c;
  --accent: #3fe0c8;
  --accent-ink: #00201b;
  --field-1: #2e6f8e;
  --field-1-opacity: .34;
  --field-2: #5f8a3e;
  --field-2-opacity: .20;
  --good: #4fd8b4;
  --grain-opacity: .045;
  --radius: 20px;

  all: initial;
  display: block;
  font-family: 'Instrument Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 15px;
  line-height: 1.55;
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  container-type: inline-size;
}

/* --- Profile: group (brief Layer 9) --- */
:host([data-profile="group"]) {
  --bg: #151109;
  --panel: rgba(244,239,226,.05);
  --panel-2: rgba(244,239,226,.085);
  --line: rgba(244,239,226,.16);
  --text: #f4efe2;
  --text-2: #b3a98f;
  --text-3: #867c66;
  --accent: #cbe93f;
  --accent-ink: #171200;
  --field-1: #8c9839;
  --field-1-opacity: .30;
  --field-2: #e8b45c;
  --field-2-opacity: .16;
  --good: #6fd8ae;
  --grain-opacity: .055;
}

/* --- Light surfaces ---
 * A bright accent that works on a dark ground fails as a background for dark
 * ink on a light one, so each profile names its own light-surface accent
 * rather than reusing the dark value.
 */
:host([data-surface="light"]) {
  --bg: #f4f7f5;
  --panel: rgba(12,17,14,.035);
  --panel-2: rgba(12,17,14,.06);
  --line: rgba(12,17,14,.14);
  --text: #0f1a15;
  --text-2: #4a5850;
  --text-3: #6d7c74;
  --accent: #0d6f5e;
  --accent-ink: #ffffff;
  --good: #0d6f5e;
}

:host([data-profile="group"][data-surface="light"]) {
  --bg: #f7f5ef;
  --panel: rgba(21,17,9,.035);
  --panel-2: rgba(21,17,9,.06);
  --line: rgba(21,17,9,.14);
  --text: #211b0f;
  --text-2: #59513f;
  --text-3: #7d7460;
  --accent: #6f7a2b;
  --accent-ink: #ffffff;
  --good: #1d7a56;
}

* { box-sizing: border-box; }

.card {
  position: relative;
  overflow: hidden;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 26px;
}

/* Two diffuse fields, rationed: one behind the tool, one behind the result. */
.blob { position: absolute; border-radius: 50%; filter: blur(78px); pointer-events: none; }
.blob-a { width: 320px; height: 320px; background: var(--field-1); opacity: var(--field-1-opacity); top: -130px; left: -60px; }
.blob-b { width: 260px; height: 260px; background: var(--field-2); opacity: var(--field-2-opacity); bottom: -120px; right: -70px; }
:host([data-surface="light"]) .blob { opacity: .12; }

.grain {
  position: absolute; inset: 0; pointer-events: none; opacity: var(--grain-opacity); mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E");
}
:host([data-surface="light"]) .grain { display: none; }

.inner { position: relative; }

h2 { margin: 0 0 6px; font-size: 22px; font-weight: 600; letter-spacing: -.032em; line-height: 1.15; }
p  { margin: 0 0 14px; color: var(--text-2); font-size: 14px; max-width: 58ch; }
p:last-child { margin-bottom: 0; }

.steps { display: flex; gap: 6px; margin-bottom: 18px; }
.step-pip { flex: 1; height: 3px; border-radius: 999px; background: var(--panel-2); }
.step-pip.done { background: var(--accent); }
.step-label { color: var(--text-3); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 8px; }

.field { display: block; margin-bottom: 14px; }
.field > span { display: block; color: var(--text-2); font-size: 12.5px; margin-bottom: 5px; }
.hint { color: var(--text-3); font-size: 11.5px; margin-top: 5px; }

input, select, textarea {
  width: 100%; font: inherit; font-size: 14px; color: var(--text);
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  padding: 9px 11px; appearance: none;
}
:host([data-surface="light"]) select { background-image: none; }
select option { color: #14201a; background: #fff; }
textarea { min-height: 76px; resize: vertical; }
input:focus, select:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
input::placeholder, textarea::placeholder { color: var(--text-3); }

.row { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
@container (max-width: 460px) { .row { grid-template-columns: 1fr; } }

.chips { display: flex; flex-wrap: wrap; gap: 7px; }
.chip {
  font: inherit; font-size: 13px; cursor: pointer;
  background: var(--panel); color: var(--text-2);
  border: 1px solid var(--line); border-radius: 999px; padding: 6px 13px;
}
.chip:hover { background: var(--panel-2); color: var(--text); }
.chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }

.btn {
  font: inherit; font-size: 14px; font-weight: 500; cursor: pointer;
  border: 1px solid var(--line); background: var(--panel); color: var(--text);
  border-radius: 11px; padding: 10px 18px;
}
.btn:hover:not(:disabled) { background: var(--panel-2); }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 18px; }
.spacer { flex: 1; }

.result {
  margin: 18px 0; padding: 16px 18px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
}
.result .figure { font-size: 30px; font-weight: 600; letter-spacing: -.035em; color: var(--accent); line-height: 1.1; }
:host([data-surface="light"]) .result .figure { color: var(--accent); }
.result .sub { color: var(--text-2); font-size: 13px; margin-top: 4px; }
.result .lead { color: var(--text-2); font-size: 13px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }

.notice { font-size: 13px; color: var(--text-2); border-radius: 12px; border: 1px solid var(--line); padding: 11px 14px; margin-bottom: 14px; }
.notice strong { color: var(--text); }
.notice.err { border-color: rgba(224,64,90,.5); background: rgba(224,64,90,.1); color: #f5a2b1; }
:host([data-surface="light"]) .notice.err { background: rgba(224,64,90,.08); color: #a3243a; }

.done-mark { font-size: 26px; color: var(--good); line-height: 1; margin-bottom: 10px; }

.soft { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--line); }
.soft .row-inline { display: flex; gap: 8px; }
.soft .row-inline input { flex: 1; }
@container (max-width: 460px) { .soft .row-inline { flex-direction: column; } }

.legal { color: var(--text-3); font-size: 11.5px; margin-top: 14px; }

.sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;
