/**
 * main.js - Application entry point and orchestrator for Dual-Stream Comparison
 */

import { $, fetchJSON } from './UIHelpers.js';
import { PlayerController } from './PlayerController.js';
import { SettingsController } from './SettingsController.js';
import { MetricsDisplay } from './MetricsDisplay.js';
import { ChartController } from './ChartController.js';
import { NotificationPanel } from './NotificationPanel.js';

// ---- State ----
let sharedChartController;
const players = {}; // Object to hold our isolated player instances

// ---- Initialization ----
async function init() {
    // Verify dash.js is loaded
    if (typeof dashjs === 'undefined') {
        const msg = 'dash.js library not found.';
        console.error(msg);
        document.body.prepend(createAlert(msg));
        return;
    }

    // 1. Initialize Shared Chart for comparative metrics
    sharedChartController = new ChartController();
    sharedChartController.init();

    // 2. Instantiate Player 1 (Baseline)
    players.baseline = await setupPlayerInstance(
        'baseline-container',
        'Stream 1 (Baseline)',
        'p1'
    );

    // 3. Instantiate Player 2 (Experimental)
    players.experimental = await setupPlayerInstance(
        'experimental-container',
        'Stream 2 (Experimental)',
        'p2'
    );

    // ==========================================
    // 3.5 Global Synchronization Controls
    // ==========================================
    const v1 = players.baseline.playerController.video;
    const v2 = players.experimental.playerController.video;
    const syncCheck = document.getElementById('chk-sync-playback');

    // Global Load (Aligns Chart X-Axis)
    document.getElementById('btn-global-load').addEventListener('click', () => {
        // Clear the shared chart first
        sharedChartController.clearAllData();

        // Load both at the exact same millisecond
        players.baseline.doLoad();
        players.experimental.doLoad();
    });

    // Global Play/Pause
    document.getElementById('btn-global-play').addEventListener('click', () => {
        v1.play(); v2.play();
    });
    document.getElementById('btn-global-pause').addEventListener('click', () => {
        v1.pause(); v2.pause();
    });

    // Optional Master/Slave Time Locking (Baseline dictates time)
    v1.addEventListener('play', () => { if (syncCheck.checked) v2.play(); });
    v1.addEventListener('pause', () => { if (syncCheck.checked) v2.pause(); });
    v1.addEventListener('seeked', () => { if (syncCheck.checked) v2.currentTime = v1.currentTime; });
    v1.addEventListener('timeupdate', () => {
        if (syncCheck.checked && !v1.paused) {
            // Snap Player 2 to Player 1 if it drifts by more than 0.5 seconds
            if (Math.abs(v1.currentTime - v2.currentTime) > 0.5) {
                v2.currentTime = v1.currentTime;
            }
        }
    });

    // 4. Global UI Setup
    initThemeToggle();
    loadContributors();

    const tooltipElements = document.querySelectorAll('[data-bs-toggle="tooltip"]');
    for (const el of tooltipElements) {
        new bootstrap.Tooltip(el);
    }
}

/**
 * Creates and initializes a completely isolated player instance from the HTML template.
 */
async function setupPlayerInstance(containerId, title, suffix) {
    // 1. Clone the template and scope the DOM
    const container = createPlayerDOM(containerId, title, suffix);

    // 2. Initialize Player Controller
    const videoElement = $('.video-element', container);
    const playerController = new PlayerController();
    playerController.init(videoElement, true);

    // Load default config safely
    try {
        const config = await fetchJSON('app/data/dashjs_config.json');
        playerController.updateSettings(config);
    } catch (err) {
        playerController.updateSettings({ debug: { logLevel: 3 } });
    }

    // 3. Initialize Scoped Settings Controller
    const settingsController = new SettingsController(playerController, container, suffix);
    settingsController.init();

    // 4. Initialize Scoped Metrics Display
    const metricsDisplay = new MetricsDisplay(playerController, sharedChartController, container, suffix);
    metricsDisplay.init();

    // 5. Initialize Scoped Notification Panel
    const notificationPanel = new NotificationPanel(playerController, container, suffix);
    notificationPanel.init();

    // 6. Bind Local UI Handlers
    const loadBtn = $('.btn-load', container);
    const urlInput = $('.stream-url', container);

    const doLoad = () => {
        const url = urlInput.value;
        if (!url) return;

        const config = settingsController.buildConfig();
        playerController.updateSettings(config);
        playerController.player.setAutoPlay(settingsController.autoPlay);

        playerController.load(url, null);
    };

    loadBtn.addEventListener('click', doLoad);
    urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doLoad();
    });

    // Handle loop fallback
    playerController.on('playbackEnded', (e) => {
        if (settingsController.loop && !playerController.isDynamic && e.isLast) {
            playerController.player.seek(0);
            playerController.player.play();
        }
    });

    return {
        container,
        playerController,
        settingsController,
        metricsDisplay,
        notificationPanel,
        doLoad
    };
}

/**
 * Helper to clone the UI template and suffix IDs to prevent collisions
 */
function createPlayerDOM(containerId, title, suffix) {
    const template = document.getElementById('player-ui-template');
    const clone = template.content.cloneNode(true);

    // Set Title
    clone.querySelector('.instance-title').textContent = title;

    // Suffix IDs and labels
    clone.querySelectorAll('[id]').forEach(el => el.id = `${el.id}-${suffix}`);
    clone.querySelectorAll('[for]').forEach(el => el.setAttribute('for', `${el.getAttribute('for')}-${suffix}`));

    // Mount to DOM
    const wrapper = document.createElement('div');
    wrapper.id = containerId;
    wrapper.className = 'player-instance';
    wrapper.appendChild(clone);

    document.getElementById('dual-players-container').appendChild(wrapper);
    return document.getElementById(containerId);
}

// ---- Global Helpers ----
function createAlert(msg) {
    const alert = document.createElement('div');
    alert.className = 'alert alert-danger m-4';
    alert.innerHTML = `<strong>Error:</strong> ${msg}`;
    return alert;
}

function initThemeToggle() {
    const select = document.getElementById('theme-select');
    if (!select) return;

    const STORAGE_KEY = 'rp-theme';
    const THEMES = ['light', 'dark'];

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-bs-theme', theme);
        select.value = theme;
        if (sharedChartController) sharedChartController.updateTheme();
    }

    const saved = localStorage.getItem(STORAGE_KEY);
    applyTheme(THEMES.includes(saved) ? saved : 'light');

    select.addEventListener('change', () => {
        const nextTheme = THEMES.includes(select.value) ? select.value : 'light';
        localStorage.setItem(STORAGE_KEY, nextTheme);
        applyTheme(nextTheme);
    });
}

async function loadContributors() {
    try {
        const data = await fetchJSON('app/data/contributors.json');
        const container = document.getElementById('contributor-logos');
        if (!container || !data.items) return;

        for (const contrib of data.items) {
            const a = document.createElement('a');
            a.href = contrib.link || '#';
            a.target = '_blank';
            a.title = contrib.name || '';
            if (contrib.logo) {
                const img = document.createElement('img');
                img.src = contrib.logo;
                a.appendChild(img);
            } else {
                a.textContent = contrib.name;
            }
            container.appendChild(a);
        }
    } catch (err) { }
}

// ---- Start the app ----
init().catch(err => {
    console.error('Failed to initialize reference player:', err);
});