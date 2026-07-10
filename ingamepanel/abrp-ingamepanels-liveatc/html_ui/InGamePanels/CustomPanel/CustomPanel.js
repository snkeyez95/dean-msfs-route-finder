// ABRP Live ATC — MSFS in-game toolbar panel shell (v6.8.0 POC).
// Based on the community toolbar-window template by Maximus (msfs2020-toolbar-window-template),
// the same base used by the SimAware / Cockpit Companion panels. The shell is deliberately DUMB:
// it only hosts an iframe pointing at the page A Better Route Planner serves on localhost —
// all UI and data live in ABRP, so this package never needs updating for UI changes.
// NOTE: internal names (CustomPanel, PANEL_CUSTOM_PANEL, the icon name) are bound by the
// prebuilt InGamePanels .spb — do not rename them.
const ABRP_PANEL_URL = 'http://localhost:8177/panel';

class IngamePanelCustomPanel extends TemplateElement {
    constructor() {
        super(...arguments);
        this.panelActive = false;
        this.started = false;
        this.ingameUi = null;
        this.initialize();
    }
    connectedCallback() {
        super.connectedCallback();
        var self = this;
        this.ingameUi = this.querySelector('ingame-ui');
        this.iframeElement = document.getElementById('CustomPanelIframe');
        this.m_MainDisplay = document.querySelector('#MainDisplay');
        if (this.m_MainDisplay) this.m_MainDisplay.classList.add('hidden');
        this.m_Footer = document.querySelector('#Footer');
        if (this.m_Footer) this.m_Footer.classList.add('hidden');
        if (this.ingameUi) {
            // Load the ABRP page only while the panel is open; blank it when closed (no idle polling).
            this.ingameUi.addEventListener('panelActive', function () {
                self.panelActive = true;
                if (self.iframeElement) self.iframeElement.src = ABRP_PANEL_URL;
            });
            this.ingameUi.addEventListener('panelInactive', function () {
                self.panelActive = false;
                if (self.iframeElement) self.iframeElement.src = '';
            });
        }
    }
    initialize() {
        if (this.started) return;
        this.started = true;
    }
    disconnectedCallback() {
        super.disconnectedCallback();
    }
}
window.customElements.define('ingamepanel-custom', IngamePanelCustomPanel);
checkAutoload();
