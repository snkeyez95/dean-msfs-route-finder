'use strict';
// Editable report assets (split out of report_assets.json so the CSS/JS can be enhanced). report_html.js
// and report_combined.js require this instead of the JSON. Post-port: these are the source of truth.
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'report_assets');
const rd = f => fs.readFileSync(path.join(dir, f), 'utf8');
module.exports = { THEME_BASE_CSS: rd('theme_base.css'), THEME_JS: rd('theme.js'), REPORT_CSS: rd('report.css'),
  REPORT_JS: rd('report.js'), CHART_JS: rd('chart.js'), NAV_JS: rd('nav.js'), DASH_CSS: rd('dash.css'), DASH_JS: rd('dash.js') };
