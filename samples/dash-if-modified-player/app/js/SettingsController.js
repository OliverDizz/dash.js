/**
 * SettingsController.js - Options panel state management and URL export/import
 */

import { $ } from './UIHelpers.js';
import SETTINGS_DESCRIPTIONS from '../data/settingsDescriptions.js';

export class SettingsController {
    // 1. Updated constructor to accept containerScope and suffix
    constructor(playerController, containerScope, suffix) {
        this.playerController = playerController;
        this.player = playerController.player;
        this.containerScope = containerScope; // e.g., document.getElementById('player-1-wrap')
        this.suffix = suffix;                 // e.g., 'p1'
        this._defaultSettings = null;
        this._autoPlay = true;
        this._loop = true;
        this._restoredProtData = null;
    }

    /**
     * Helper to find elements by their suffixed ID within this instance's container.
     * Falls back to class selectors for structural elements modified in the template.
     */
    _el(baseId) {
        return $(`#${baseId}-${this.suffix}`, this.containerScope)
            || $(`.${baseId}`, this.containerScope)
            || $(`#${baseId}`, this.containerScope);
    }

    /**
     * Initialize all settings bindings and save defaults
     */
    init() {
        this._defaultSettings = JSON.parse(JSON.stringify(this.player.getSettings()));
        this._bindAll();
        this._syncFromPlayer();
        this._addTooltips();
    }

    get autoPlay() { return this._autoPlay; }
    get loop() { return this._loop; }
    get restoredProtData() { return this._restoredProtData || null; }

    /**
     * Build a config object from all current UI settings
     * @returns {Object}
     */
    buildConfig() {
        // Extract values safely using the scoped helper
        const getVal = (id) => this._el(id) ? this._el(id).value : '';
        const getFloat = (id) => parseFloat(getVal(id));
        const getInt = (id) => parseInt(getVal(id));

        const config = {
            debug: {
                logLevel: !isNaN(getInt('opt-log-level')) ? getInt('opt-log-level') : 3
            },
            streaming: {
                scheduling: {
                    scheduleWhilePaused: this._isChecked('opt-schedule-while-paused')
                },
                gaps: {
                    jumpGaps: this._isChecked('opt-jump-gaps')
                },
                buffer: {
                    stallThreshold: getFloat('opt-stall-threshold') || 0.5,
                    lowLatencyStallThreshold: getFloat('opt-ll-stall-threshold') || 0.3,
                    fastSwitchEnabled: this._isChecked('opt-fast-switch'),
                    reuseExistingSourceBuffers: this._isChecked('opt-reuse-sourcebuffers'),
                    mediaSourceDurationInfinity: this._isChecked('opt-mediasource-duration-inf'),
                    resetSourceBuffersForTrackSwitch: this._isChecked('opt-reset-sb-track-switch')
                },
                abr: {
                    autoSwitchBitrate: {
                        video: this._isChecked('opt-auto-switch-video')
                    },
                    rules: {
                        throughputRule: { active: this._isChecked('opt-rule-throughput') },
                        bolaRule: { active: this._isChecked('opt-rule-bola') },
                        insufficientBufferRule: { active: this._isChecked('opt-rule-insufficient-buffer') },
                        switchHistoryRule: { active: this._isChecked('opt-rule-switch-history') },
                        droppedFramesRule: { active: this._isChecked('opt-rule-dropped-frames') },
                        abandonRequestsRule: { active: this._isChecked('opt-rule-abandon') },
                        l2ARule: { active: this._isChecked('opt-rule-l2a') },
                        loLPRule: { active: this._isChecked('opt-rule-lolp') }
                    }
                },
                text: {
                    defaultEnabled: this._isChecked('opt-text-default-enabled'),
                    imsc: {
                        enableRollUp: this._isChecked('opt-imsc-rollup'),
                        displayForcedOnlyMode: this._isChecked('opt-imsc-forced-only')
                    }
                },
                trackSwitchMode: {
                    audio: this._getRadioValue('track-audio'),
                    video: this._getRadioValue('track-video')
                },
                timeShiftBuffer: {
                    calcFromSegmentTimeline: this._isChecked('opt-calc-seg-avail')
                },
                delay: {
                    useSuggestedPresentationDelay: this._isChecked('opt-use-suggested-pd')
                },
                saveLastMediaSettingsForCurrentStreamingSession: this._isChecked('opt-save-last-media'),
                lastBitrateCachingInfo: {
                    enabled: this._isChecked('opt-local-storage')
                },
                lastMediaSettingsCachingInfo: {
                    enabled: this._isChecked('opt-local-storage')
                },
                applyContentSteering: this._isChecked('opt-content-steering'),
                liveCatchup: {
                    enabled: this._isChecked('opt-catchup-enabled'),
                    mode: getVal('opt-catchup-mode')
                },
                applyServiceDescription: this._isChecked('opt-apply-service-desc')
            }
        };

        // Live catchup numeric settings
        if (!isNaN(getFloat('opt-catchup-max-drift'))) config.streaming.liveCatchup.maxDrift = getFloat('opt-catchup-max-drift');
        if (!isNaN(getFloat('opt-catchup-live-threshold'))) config.streaming.liveCatchup.liveThreshold = getFloat('opt-catchup-live-threshold');

        // Live catchup step tuning
        const stepStartMin = getFloat('opt-catchup-step-start-min');
        const stepStartMax = getFloat('opt-catchup-step-start-max');
        const stepStopMin = getFloat('opt-catchup-step-stop-min');
        const stepStopMax = getFloat('opt-catchup-step-stop-max');

        if (!isNaN(stepStartMin) || !isNaN(stepStartMax) || !isNaN(stepStopMin) || !isNaN(stepStopMax)) {
            config.streaming.liveCatchup.step = { start: {}, stop: {} };
            if (!isNaN(stepStartMin)) config.streaming.liveCatchup.step.start.min = stepStartMin;
            if (!isNaN(stepStartMax)) config.streaming.liveCatchup.step.start.max = stepStartMax;
            if (!isNaN(stepStopMin)) config.streaming.liveCatchup.step.stop.min = stepStopMin;
            if (!isNaN(stepStopMax)) config.streaming.liveCatchup.step.stop.max = stepStopMax;
        }

        // Live delay
        if (!isNaN(getFloat('opt-live-delay')) && getFloat('opt-live-delay') > 0) config.streaming.delay.liveDelay = getFloat('opt-live-delay');
        if (!isNaN(getInt('opt-live-delay-frag-count')) && getInt('opt-live-delay-frag-count') > 0) config.streaming.delay.liveDelayFragmentCount = getInt('opt-live-delay-frag-count');

        // UTC offset
        const utcOffset = getInt('opt-utc-offset');
        if (utcOffset !== 0 && !isNaN(utcOffset)) {
            config.streaming.utcSynchronization = config.streaming.utcSynchronization || {};
            config.streaming.utcSynchronization.defaultTimingSource = { value: utcOffset };
        }

        // Bitrates
        if (!isNaN(getInt('opt-init-bitrate-video')) && getInt('opt-init-bitrate-video') > 0) config.streaming.abr.initialBitrate = { video: getInt('opt-init-bitrate-video') };
        if (!isNaN(getInt('opt-min-bitrate-video')) && getInt('opt-min-bitrate-video') > 0) config.streaming.abr.minBitrate = { video: getInt('opt-min-bitrate-video') };
        if (!isNaN(getInt('opt-max-bitrate-video')) && getInt('opt-max-bitrate-video') > 0) config.streaming.abr.maxBitrate = { video: getInt('opt-max-bitrate-video') };

        // CMCD
        if (this._isChecked('opt-cmcd-enabled')) {
            config.streaming.cmcd = {
                enabled: true,
                mode: getVal('opt-cmcd-mode'),
                rtpSafetyFactor: getFloat('opt-cmcd-rtp-safety') || 5
            };
            if (getVal('opt-cmcd-session-id').trim()) config.streaming.cmcd.sid = getVal('opt-cmcd-session-id').trim();
            if (getVal('opt-cmcd-content-id').trim()) config.streaming.cmcd.cid = getVal('opt-cmcd-content-id').trim();
            if (!isNaN(getInt('opt-cmcd-rtp')) && getInt('opt-cmcd-rtp') > 0) config.streaming.cmcd.rtp = getInt('opt-cmcd-rtp');
            if (getVal('opt-cmcd-enabled-keys').trim()) config.streaming.cmcd.enabledKeys = getVal('opt-cmcd-enabled-keys').trim().split(',').map(k => k.trim());
        }

        // CMSD
        if (this._isChecked('opt-cmsd-enabled')) {
            config.streaming.cmsd = {
                enabled: true,
                abr: {
                    applyMb: this._isChecked('opt-cmsd-apply-mb'),
                    etpWeightRatio: getFloat('opt-cmsd-etp-weight') || 0.5
                }
            };
        }

        // Enhancement (LCEVC)
        config.streaming.enhancement = {
            enabled: this._isChecked('opt-enhancement-enabled')
        };

        return config;
    }

    applyInitialMediaSettings() {
        const getVal = (id) => this._el(id) ? this._el(id).value.trim() : '';

        // Video
        if (getVal('opt-init-role-video')) this.playerController.setInitialMediaSettings('video', { role: getVal('opt-init-role-video') });

        // Audio
        const audioSettings = {};
        if (getVal('opt-init-lang-audio')) audioSettings.lang = getVal('opt-init-lang-audio');
        if (getVal('opt-init-role-audio')) audioSettings.role = getVal('opt-init-role-audio');

        const accessScheme = getVal('opt-audio-accessibility-scheme');
        const accessValue = getVal('opt-audio-accessibility-value');
        if (accessScheme && accessValue) {
            let schemeId = accessScheme === 'mpeg' ? 'urn:mpeg:dash:role:2011' : 'urn:tva:metadata:cs:AudioPurposeCS:2007';
            audioSettings.accessibility = { schemeIdUri: schemeId, value: accessValue };
        }

        if (Object.keys(audioSettings).length > 0) this.playerController.setInitialMediaSettings('audio', audioSettings);

        // Text
        const textSettings = {};
        if (getVal('opt-init-lang-text')) textSettings.lang = getVal('opt-init-lang-text');
        if (getVal('opt-init-role-text')) textSettings.role = getVal('opt-init-role-text');
        if (Object.keys(textSettings).length > 0) this.playerController.setInitialMediaSettings('text', textSettings);

        this.playerController.enableForcedTextStreaming(this._isChecked('opt-force-text-streaming'));
    }

    copySettingsUrl(protectionData) {
        const currentSettings = this.player.getSettings();
        const diff = this._makeSettingsDiff(currentSettings, this._defaultSettings);
        const params = new URLSearchParams();

        this._flattenObject(diff, '', params);

        if (this._isChecked('opt-autoplay')) params.set('autoplay', 'true');
        if (this._isChecked('opt-loop')) params.set('loop', 'true');
        if (this._isChecked('opt-muted')) params.set('muted', 'true');

        const url = new URL(window.location.href.split('?')[0]);
        url.search = params.toString();

        const streamUrlInput = this.containerScope.querySelector('.stream-url') || this._el('stream-url');
        if (streamUrlInput && streamUrlInput.value.trim()) {
            url.searchParams.set('stream', streamUrlInput.value.trim());
        }

        if (protectionData && Object.keys(protectionData).length > 0) {
            try {
                url.searchParams.set('protData', btoa(JSON.stringify(protectionData)));
            } catch (e) { }
        }

        navigator.clipboard.writeText(url.toString()).then(() => {
            this._showCopyNotification();
        }).catch(() => {
            const textarea = document.createElement('textarea');
            textarea.value = url.toString();
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            this._showCopyNotification();
        });
    }

    applyFromUrl() {
        const params = new URLSearchParams(window.location.search);
        if (params.size === 0) return;

        const streamUrl = params.get('stream');
        const streamUrlInput = this.containerScope.querySelector('.stream-url') || this._el('stream-url');
        if (streamUrl && streamUrlInput) streamUrlInput.value = streamUrl;

        if (params.get('autoplay') === 'true') {
            this._setChecked('opt-autoplay', true);
            this._autoPlay = true;
        }
        if (params.get('loop') === 'true') {
            this._setChecked('opt-loop', true);
            this._loop = true;
        }
        if (params.get('muted') === 'true') {
            this._setChecked('opt-muted', true);
        }

        const protDataParam = params.get('protData');
        if (protDataParam) {
            try { this._restoredProtData = JSON.parse(atob(protDataParam)); } catch (e) { }
        }

        const settingsObj = {};
        for (const [key, value] of params.entries()) {
            if (['stream', 'autoplay', 'loop', 'muted', 'autoLoad', 'protData'].includes(key)) continue;
            this._setNestedValue(settingsObj, key, this._coerceType(value));
        }

        if (Object.keys(settingsObj).length > 0) {
            this.player.updateSettings(settingsObj);
            this._syncFromPlayer();
        }

        return (params.get('autoLoad') === 'true' && streamUrl);
    }

    // ---- Private ----

    _bindAll() {
        const btnOptions = this.containerScope.querySelector('.btn-options') || this._el('btn-options');
        const panelOptions = this.containerScope.querySelector('.options-panel') || this._el('options-panel');

        if (btnOptions && panelOptions) {
            btnOptions.addEventListener('click', () => {
                panelOptions.classList.toggle('collapsed');
                const isCollapsed = panelOptions.classList.contains('collapsed');
                btnOptions.innerHTML = isCollapsed
                    ? '<i class="bi bi-gear"></i> Options'
                    : '<i class="bi bi-gear-fill"></i> Hide';
            });
        }

        this._bindCheckbox('opt-autoplay', () => {
            this._autoPlay = this._isChecked('opt-autoplay');
            this.player.setAutoPlay(this._autoPlay);
        });
        this._bindCheckbox('opt-loop', () => {
            this._loop = this._isChecked('opt-loop');
        });
        this._bindCheckbox('opt-muted', () => {
            this.player.setMute(this._isChecked('opt-muted'));
        });

        const settingsCheckboxes = [
            'opt-schedule-while-paused', 'opt-calc-seg-avail', 'opt-reuse-sourcebuffers',
            'opt-mediasource-duration-inf', 'opt-reset-sb-track-switch', 'opt-save-last-media',
            'opt-local-storage', 'opt-jump-gaps', 'opt-content-steering', 'opt-catchup-enabled',
            'opt-fast-switch', 'opt-auto-switch-video', 'opt-rule-throughput', 'opt-rule-bola',
            'opt-rule-insufficient-buffer', 'opt-rule-switch-history', 'opt-rule-dropped-frames',
            'opt-rule-abandon', 'opt-rule-l2a', 'opt-rule-lolp', 'opt-text-default-enabled',
            'opt-force-text-streaming', 'opt-imsc-rollup', 'opt-imsc-forced-only',
            'opt-apply-service-desc', 'opt-use-suggested-pd', 'opt-cmcd-enabled',
            'opt-cmsd-enabled', 'opt-cmsd-apply-mb', 'opt-enhancement-enabled'
        ];

        for (const id of settingsCheckboxes) {
            this._bindCheckbox(id, () => this._applySettings());
        }

        const settingsInputs = [
            'opt-log-level', 'opt-catchup-mode', 'opt-catchup-max-drift', 'opt-catchup-live-threshold',
            'opt-catchup-step-start-min', 'opt-catchup-step-start-max', 'opt-catchup-step-stop-min',
            'opt-catchup-step-stop-max', 'opt-stall-threshold', 'opt-ll-stall-threshold',
            'opt-live-delay', 'opt-live-delay-frag-count', 'opt-utc-offset', 'opt-init-bitrate-video',
            'opt-min-bitrate-video', 'opt-max-bitrate-video', 'opt-cmcd-session-id', 'opt-cmcd-content-id',
            'opt-cmcd-rtp', 'opt-cmcd-rtp-safety', 'opt-cmcd-mode', 'opt-cmcd-enabled-keys', 'opt-cmsd-etp-weight'
        ];

        for (const id of settingsInputs) {
            const el = this._el(id);
            if (el) el.addEventListener('change', () => this._applySettings());
        }

        // Scope radio selection to container
        for (const radio of this.containerScope.querySelectorAll('input[name^="track-audio"], input[name^="track-video"]')) {
            radio.addEventListener('change', () => this._applySettings());
        }
    }

    _bindCheckbox(id, handler) {
        const el = this._el(id);
        if (el) el.addEventListener('change', handler);
    }

    _isChecked(id) {
        const el = this._el(id);
        return el ? el.checked : false;
    }

    _getRadioValue(baseName) {
        // Handle names that may or may not be suffixed by the template cloner
        const el = this.containerScope.querySelector(`input[name="${baseName}"]:checked`) ||
            this.containerScope.querySelector(`input[name="${baseName}-${this.suffix}"]:checked`);
        return el ? el.value : 'alwaysReplace';
    }

    _applySettings() {
        this.player.updateSettings(this.buildConfig());
    }

    _addTooltips() {
        for (const [id, description] of Object.entries(SETTINGS_DESCRIPTIONS)) {
            const el = this._el(id);
            if (!el) continue;

            let label;
            if (el.type === 'checkbox' || el.type === 'radio') {
                // Must account for the suffix applied to the 'for' attribute
                label = this.containerScope.querySelector(`label[for="${el.id}"]`);
            } else {
                let sibling = el.previousElementSibling;
                while (sibling) {
                    if (sibling.classList && sibling.classList.contains('option-label')) {
                        label = sibling;
                        break;
                    }
                    sibling = sibling.previousElementSibling;
                }
            }

            if (!label) continue;

            const icon = document.createElement('i');
            icon.className = 'bi bi-info-circle option-tooltip-icon';
            icon.setAttribute('data-bs-toggle', 'tooltip');
            icon.setAttribute('data-bs-placement', 'top');
            icon.setAttribute('data-bs-title', description);
            label.appendChild(icon);
        }

        if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
            const tooltipTriggerList = this.containerScope.querySelectorAll('[data-bs-toggle="tooltip"]');
            for (const el of tooltipTriggerList) {
                new bootstrap.Tooltip(el, { html: false });
            }
        }
    }

    _syncFromPlayer() {
        const s = this.player.getSettings();
        const setVal = (id, val) => { if (this._el(id) && val !== undefined) this._el(id).value = val; };

        // General
        this._setChecked('opt-schedule-while-paused', s?.streaming?.scheduling?.scheduleWhilePaused);
        this._setChecked('opt-calc-seg-avail', s?.streaming?.timeShiftBuffer?.calcFromSegmentTimeline);
        this._setChecked('opt-reuse-sourcebuffers', s?.streaming?.buffer?.reuseExistingSourceBuffers);
        this._setChecked('opt-mediasource-duration-inf', s?.streaming?.buffer?.mediaSourceDurationInfinity);
        this._setChecked('opt-reset-sb-track-switch', s?.streaming?.buffer?.resetSourceBuffersForTrackSwitch);
        this._setChecked('opt-save-last-media', s?.streaming?.saveLastMediaSettingsForCurrentStreamingSession);
        this._setChecked('opt-local-storage', s?.streaming?.lastBitrateCachingInfo?.enabled);
        this._setChecked('opt-jump-gaps', s?.streaming?.gaps?.jumpGaps);
        this._setChecked('opt-content-steering', s?.streaming?.applyContentSteering);
        this._setChecked('opt-catchup-enabled', !!s?.streaming?.liveCatchup?.enabled);

        // ABR
        this._setChecked('opt-fast-switch', !!s?.streaming?.buffer?.fastSwitchEnabled);
        this._setChecked('opt-auto-switch-video', s?.streaming?.abr?.autoSwitchBitrate?.video);
        this._setChecked('opt-rule-throughput', s?.streaming?.abr?.rules?.throughputRule?.active);
        this._setChecked('opt-rule-bola', s?.streaming?.abr?.rules?.bolaRule?.active);
        this._setChecked('opt-rule-insufficient-buffer', s?.streaming?.abr?.rules?.insufficientBufferRule?.active);
        this._setChecked('opt-rule-switch-history', s?.streaming?.abr?.rules?.switchHistoryRule?.active);
        this._setChecked('opt-rule-dropped-frames', s?.streaming?.abr?.rules?.droppedFramesRule?.active);
        this._setChecked('opt-rule-abandon', s?.streaming?.abr?.rules?.abandonRequestsRule?.active);
        this._setChecked('opt-rule-l2a', s?.streaming?.abr?.rules?.l2ARule?.active);
        this._setChecked('opt-rule-lolp', s?.streaming?.abr?.rules?.loLPRule?.active);

        // Delays & Text & CMSD/CMCD Checkboxes
        this._setChecked('opt-apply-service-desc', s?.streaming?.applyServiceDescription);
        this._setChecked('opt-use-suggested-pd', s?.streaming?.delay?.useSuggestedPresentationDelay);
        this._setChecked('opt-text-default-enabled', s?.streaming?.text?.defaultEnabled);
        this._setChecked('opt-imsc-rollup', s?.streaming?.text?.imsc?.enableRollUp);
        this._setChecked('opt-imsc-forced-only', s?.streaming?.text?.imsc?.displayForcedOnlyMode);
        this._setChecked('opt-cmcd-enabled', s?.streaming?.cmcd?.enabled);
        this._setChecked('opt-cmsd-enabled', s?.streaming?.cmsd?.enabled);
        this._setChecked('opt-cmsd-apply-mb', s?.streaming?.cmsd?.abr?.applyMb);
        this._setChecked('opt-enhancement-enabled', s?.streaming?.enhancement?.enabled);

        // Values
        setVal('opt-log-level', s?.debug?.logLevel);
        setVal('opt-catchup-mode', s?.streaming?.liveCatchup?.mode);

        const safeSetNumeric = (id, val, invalidState) => {
            if (val !== undefined && val !== invalidState && !isNaN(val)) setVal(id, val);
            else setVal(id, '');
        };

        safeSetNumeric('opt-catchup-max-drift', s?.streaming?.liveCatchup?.maxDrift);
        safeSetNumeric('opt-catchup-live-threshold', s?.streaming?.liveCatchup?.liveThreshold, -1);
        safeSetNumeric('opt-catchup-step-start-min', s?.streaming?.liveCatchup?.step?.start?.min);
        safeSetNumeric('opt-catchup-step-start-max', s?.streaming?.liveCatchup?.step?.start?.max);
        safeSetNumeric('opt-catchup-step-stop-min', s?.streaming?.liveCatchup?.step?.stop?.min);
        safeSetNumeric('opt-catchup-step-stop-max', s?.streaming?.liveCatchup?.step?.stop?.max);

        setVal('opt-stall-threshold', s?.streaming?.buffer?.stallThreshold);
        setVal('opt-ll-stall-threshold', s?.streaming?.buffer?.lowLatencyStallThreshold);
        setVal('opt-cmcd-rtp-safety', s?.streaming?.cmcd?.rtpSafetyFactor);
        setVal('opt-cmsd-etp-weight', s?.streaming?.cmsd?.abr?.etpWeightRatio);

        // Radios
        const setRadio = (group, val) => {
            if (val) {
                const r = this.containerScope.querySelector(`input[name^="track-${group}"][value="${val}"]`);
                if (r) r.checked = true;
            }
        };
        setRadio('audio', s?.streaming?.trackSwitchMode?.audio);
        setRadio('video', s?.streaming?.trackSwitchMode?.video);

        // ABR & Delays
        safeSetNumeric('opt-init-bitrate-video', s?.streaming?.abr?.initialBitrate?.video, 0);
        safeSetNumeric('opt-min-bitrate-video', s?.streaming?.abr?.minBitrate?.video, 0);
        safeSetNumeric('opt-max-bitrate-video', s?.streaming?.abr?.maxBitrate?.video, 0);
        safeSetNumeric('opt-live-delay', s?.streaming?.delay?.liveDelay, 0);
        safeSetNumeric('opt-live-delay-frag-count', s?.streaming?.delay?.liveDelayFragmentCount, 0);
        safeSetNumeric('opt-utc-offset', s?.streaming?.utcSynchronization?.defaultTimingSource?.value, 0);

        // CMCD Strings
        setVal('opt-cmcd-mode', s?.streaming?.cmcd?.mode);
        setVal('opt-cmcd-session-id', s?.streaming?.cmcd?.sid || '');
        setVal('opt-cmcd-content-id', s?.streaming?.cmcd?.cid || '');
        safeSetNumeric('opt-cmcd-rtp', s?.streaming?.cmcd?.rtp, 0);

        if (this._el('opt-cmcd-enabled-keys')) {
            const keys = s?.streaming?.cmcd?.enabledKeys;
            this._el('opt-cmcd-enabled-keys').value = Array.isArray(keys) ? keys.join(', ') : '';
        }
    }

    _setChecked(id, value) {
        const el = this._el(id);
        if (el && value !== undefined) el.checked = !!value;
    }

    _makeSettingsDiff(current, defaults, path = '') {
        const diff = {};
        for (const key of Object.keys(current)) {
            const currentVal = current[key];
            const defaultVal = defaults ? defaults[key] : undefined;
            if (currentVal && typeof currentVal === 'object' && !Array.isArray(currentVal)) {
                const subDiff = this._makeSettingsDiff(currentVal, defaultVal || {}, `${path}${key}.`);
                if (Object.keys(subDiff).length > 0) diff[key] = subDiff;
            } else if (JSON.stringify(currentVal) !== JSON.stringify(defaultVal)) {
                diff[key] = currentVal;
            }
        }
        return diff;
    }

    _flattenObject(obj, prefix, params) {
        for (const [key, value] of Object.entries(obj)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                this._flattenObject(value, fullKey, params);
            } else {
                params.set(fullKey, String(value));
            }
        }
    }

    _setNestedValue(obj, path, value) {
        const keys = path.split('.');
        let current = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!current[keys[i]]) current[keys[i]] = {};
            current = current[keys[i]];
        }
        current[keys[keys.length - 1]] = value;
    }

    _coerceType(value) {
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (value === 'null') return null;
        const num = Number(value);
        if (!isNaN(num) && value.trim() !== '') return num;
        return value;
    }

    _showCopyNotification() {
        // This is safe to keep global as it functions like a toast overlay
        const existing = document.querySelector('.copy-notification');
        if (existing) existing.remove();

        const notif = document.createElement('div');
        notif.className = 'copy-notification alert alert-success py-2 px-3';
        notif.innerHTML = '<i class="bi bi-check-circle"></i> URL Copied!';
        document.body.appendChild(notif);
        setTimeout(() => notif.remove(), 2200);
    }
}