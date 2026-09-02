import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Dash from 'resource:///org/gnome/shell/ui/dash.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

import {getTranslator} from './i18n.js';
import {BackgroundBlurLayer, BLUR_EFFECT_NAME} from './blurSurface.js';
import {TARGET_SUFFIXES as CONFIG_SUFFIXES, readSnapshot, snapshotKey} from './appearanceConfig.js';

const QUICK_EFFECTS = ['original', 'transparent', 'blur'];
const RETRY_DELAYS = [300, 800, 1600];

export default class GnomeBeautifyExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        if (!this._settings.get_boolean('remember-last')) {
            for (const prefix of ['dock', 'app']) {
                for (const suffix of CONFIG_SUFFIXES)
                    this._settings.reset(`${prefix}-${suffix}`);
            }
        }
        this._ = getTranslator(this._settings);
        this._originalActors = new Map();
        this._blurSurfaces = new Map();
        this._enabled = true;
        this._targetStates = new Map();
        this._missingTargets = new Set();
        this._committedSnapshot = null;
        this._revision = 0;
        this._refreshSource = 0;
        this._frameRefreshId = 0;
        this._retrySource = 0;
        this._retryAttempt = 0;
        this._applySource = 0;
        this._settingsChangedId = this._settings.connect('changed',
            (_settings, key) => this._onSettingChanged(key));

        this._connectOverviewSignals();
        this._extensionStateChangedId = Main.extensionManager.connect(
            'extension-state-changed', () => this._scheduleIndicatorSync());
        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', () => this._scheduleIndicatorSync());
        this._uiGroupSignalIds = [];
        if (Main.uiGroup) {
            const onUiGroupChanged = (_container, child) => {
                if (child?.get_name?.() === 'dashtodockContainer')
                    this._scheduleIndicatorSync();
            };
            this._uiGroupSignalIds.push(
                Main.uiGroup.connect('child-added', onUiGroupChanged),
                Main.uiGroup.connect('child-removed', onUiGroupChanged));
        }
        this._indicatorSyncSource = 0;

        this._interfaceSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface',
        });
        this._interfaceSignalIds = [
            this._interfaceSettings.connect('changed::color-scheme',
                () => this._queueRefresh()),
            this._interfaceSettings.connect('changed::gtk-theme',
                () => this._queueRefresh()),
        ];
        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
        this._themeChangedId = this._themeContext.connect('changed',
            () => this._queueRefresh());

        this._overviewAnimating = Boolean(Main.overview.animationInProgress);
        this._onBattery = false;
        this._setupPowerMonitor();
        this._syncIndicator();
        this._commitSettings();
    }

    disable() {
        this._enabled = false;
        for (const key of ['_refreshSource', '_retrySource']) {
            if (this[key])
                GLib.Source.remove(this[key]);
            this[key] = 0;
        }
        if (this._applySource) {
            GLib.Source.remove(this._applySource);
            this._applySource = 0;
        }
        this._cancelFrameRefresh();

        if (this._settingsChangedId)
            this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = 0;

        for (const signalId of this._overviewSignalIds ?? [])
            Main.overview.disconnect(signalId);
        this._overviewSignalIds = null;

        if (this._extensionStateChangedId)
            Main.extensionManager.disconnect(this._extensionStateChangedId);
        this._extensionStateChangedId = 0;
        if (this._monitorsChangedId)
            Main.layoutManager.disconnect(this._monitorsChangedId);
        this._monitorsChangedId = 0;
        for (const signalId of this._uiGroupSignalIds ?? [])
            Main.uiGroup.disconnect(signalId);
        this._uiGroupSignalIds = null;
        if (this._indicatorSyncSource) {
            GLib.Source.remove(this._indicatorSyncSource);
            this._indicatorSyncSource = 0;
        }

        for (const signalId of this._interfaceSignalIds ?? [])
            this._interfaceSettings.disconnect(signalId);
        this._interfaceSignalIds = null;
        this._interfaceSettings = null;
        if (this._themeContext && this._themeChangedId)
            this._themeContext.disconnect(this._themeChangedId);
        this._themeChangedId = 0;
        this._themeContext = null;

        if (this._powerProxy && this._powerChangedId)
            this._powerProxy.disconnect(this._powerChangedId);
        this._powerChangedId = 0;
        this._powerProxy = null;

        this._destroyIndicator();
        this._restoreActors();
        this._publishStatus();
        this._originalActors = null;
        this._blurSurfaces = null;
        this._targetStates = null;
        this._committedSnapshot = null;
        this._settings = null;
        this._ = null;
    }

    _onSettingChanged(key) {
        if (key === 'runtime-status')
            return;
        if (key === 'status-request') {
            this._publishStatus();
            return;
        }
        if (key === 'language-mode') {
            this._ = getTranslator(this._settings);
            this._rebuildQuickMenu();
            return;
        }

        if (key === 'show-indicator') {
            this._syncIndicator();
            return;
        }
        if (key === 'remember-last')
            return;
        if (key === 'apply-delay') {
            if (this._applySource)
                this._scheduleApply();
            return;
        }
        if (key.startsWith('app-') && this._settings.get_boolean('linked-targets'))
            return;

        this._updateQuickMenu();
        // Discrete choices are coalesced into the next main-loop turn. Only
        // continuous appearance parameters use the user's debounce interval.
        this._scheduleApply(key === 'linked-targets' || key.endsWith('-effect') ||
            key === 'performance-protection' || key === 'battery-reduce');
    }

    _scheduleApply(immediate = false) {
        if (this._applySource) {
            GLib.Source.remove(this._applySource);
            this._applySource = 0;
        }

        const delay = immediate ? 0 : this._settings.get_int('apply-delay');
        this._applySource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._applySource = 0;
            this._commitSettings();
            return GLib.SOURCE_REMOVE;
        });
        this._publishStatus();
    }

    _commitSettings() {
        if (this._applySource)
            GLib.Source.remove(this._applySource);
        this._applySource = 0;
        if (this._refreshSource)
            GLib.Source.remove(this._refreshSource);
        this._refreshSource = 0;
        this._cancelFrameRefresh();
        if (this._retrySource)
            GLib.Source.remove(this._retrySource);
        this._retrySource = 0;
        this._retryAttempt = 0;
        this._committedSnapshot = readSnapshot(this._settings);
        for (const record of this._originalActors.values()) {
            record.repairAttempts = 0;
            record.repairWindow = 0;
        }
        this._revision++;
        this._applyEffects(this._committedSnapshot);
    }

    _queueRefresh() {
        if (!this._enabled || !this._committedSnapshot || this._refreshSource || this._frameRefreshId)
            return;
        this._refreshSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this._refreshSource = 0;
            // Never read a half-adjusted setting or cancel its debounce here.
            this._applyEffects(this._committedSnapshot);
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelFrameRefresh() {
        if (this._frameRefreshId)
            global.compositor.get_laters().remove(this._frameRefreshId);
        this._frameRefreshId = 0;
    }

    _queueFrameRefresh() {
        if (!this._enabled || !this._committedSnapshot || this._frameRefreshId)
            return;
        // Overview._hideDone() clears Main.panel.style *after* 'hidden'.
        // Coalesce that reset with lifecycle events before the next paint,
        // otherwise the default black panel is visible during our 50ms timer.
        if (this._refreshSource)
            GLib.Source.remove(this._refreshSource);
        this._refreshSource = 0;
        this._frameRefreshId = global.compositor.get_laters().add(
            Meta.LaterType.BEFORE_REDRAW, () => {
                this._frameRefreshId = 0;
                if (this._enabled)
                    this._applyEffects(this._committedSnapshot);
                return false;
            });
    }

    _scheduleRetry() {
        if (!this._enabled || this._retrySource || this._retryAttempt >= RETRY_DELAYS.length)
            return;
        this._retrySource = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            RETRY_DELAYS[this._retryAttempt++], () => {
                this._retrySource = 0;
                this._applyEffects(this._committedSnapshot);
                return GLib.SOURCE_REMOVE;
            });
    }

    _publishStatus() {
        if (!this._settings || this._applying)
            return;
        const targets = {};
        for (const target of ['dock', 'app']) {
            const states = [...(this._targetStates?.values() ?? [])]
                .filter(item => item.target === target).map(item => item.state);
            targets[target] = states.includes('failed') ? 'failed'
                : this._missingTargets?.has(target) || !states.length ? 'missing'
                    : states.includes('waiting') ? 'waiting'
                        : states.includes('applied') ? 'applied' : 'hidden';
        }
        const status = JSON.stringify({
            request: this._settings.get_string('status-request'),
            active: this._enabled,
            configKey: this._committedSnapshot ? snapshotKey(this._committedSnapshot) : '',
            revision: this._revision,
            pending: Boolean(this._applySource),
            retrying: Boolean(this._retrySource),
            targets,
        });
        if (this._settings.get_string('runtime-status') !== status)
            this._settings.set_string('runtime-status', status);
    }

    _connectOverviewSignals() {
        this._overviewSignalIds = [
            Main.overview.connect('showing', () => this._beginOverviewAnimation()),
            Main.overview.connect('hiding', () => this._beginOverviewAnimation()),
            Main.overview.connect('shown', () => this._endOverviewAnimation()),
            Main.overview.connect('hidden', () => this._endOverviewAnimation()),
        ];
    }

    _beginOverviewAnimation() {
        this._overviewAnimating = true;
        this._queueFrameRefresh();
    }

    _endOverviewAnimation() {
        this._overviewAnimating = false;
        // Also refresh when protection is off: Shell resets panel styling
        // independently of that preference. Never commit pending drag values.
        this._queueFrameRefresh();
    }

    _setupPowerMonitor() {
        try {
            this._powerProxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SYSTEM,
                Gio.DBusProxyFlags.NONE,
                null,
                'org.freedesktop.UPower',
                '/org/freedesktop/UPower',
                'org.freedesktop.UPower',
                null);
            this._readBatteryState();
            this._powerChangedId = this._powerProxy.connect('g-properties-changed', () => {
                const previous = this._onBattery;
                this._readBatteryState();
                if (previous !== this._onBattery)
                    this._queueRefresh();
            });
        } catch (error) {
            console.debug(`${this.uuid}: UPower unavailable: ${error.message}`);
        }
    }

    _readBatteryState() {
        const value = this._powerProxy?.get_cached_property('OnBattery');
        this._onBattery = value?.deepUnpack() ?? false;
    }

    _syncIndicator() {
        const shouldShow = this._settings.get_boolean('show-indicator');
        if (!shouldShow) {
            this._destroyIndicator();
            return;
        }

        const target = this._findDockTarget();
        if (!target) {
            this._destroyIndicator();
            return;
        }

        if (this._dashItem && this._indicatorContainer === target.container)
            return;

        this._destroyIndicator();
        try {
            this._createIndicator(target);
        } catch (error) {
            console.warn(`${this.uuid}: failed to attach Dock shortcut: ${error.message}`);
            this._destroyIndicator();
            const dash = Main.overview.dash;
            if (target.dash !== dash && dash?._dashContainer) {
                this._createIndicator({
                    dash,
                    container: dash._dashContainer,
                    side: St.Side.BOTTOM,
                });
            }
        }
    }

    _scheduleIndicatorSync(delay = 300) {
        if (!this._settings)
            return;
        if (this._indicatorSyncSource)
            GLib.Source.remove(this._indicatorSyncSource);
        this._indicatorSyncSource = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, delay, () => {
                this._indicatorSyncSource = 0;
                try {
                    this._syncIndicator();
                } finally {
                    this._retryAttempt = 0;
                    this._queueRefresh();
                }
                return GLib.SOURCE_REMOVE;
            });
    }

    _findPersistentDocks() {
        const persistentDocks = [];
        const pending = [global.stage];
        while (pending.length > 0) {
            const actor = pending.pop();
            try {
                if (actor.get_name?.() === 'dashtodockContainer' &&
                    actor.dash?._dashContainer)
                    persistentDocks.push(actor);
                pending.push(...(actor.get_children?.() ?? []));
            } catch (error) {
                console.debug(`${this.uuid}: unavailable dock actor: ${error.message}`);
            }
        }
        return persistentDocks;
    }

    _findDockTarget() {
        const persistentDocks = this._findPersistentDocks();
        const primaryIndex = Main.layoutManager.primaryIndex;
        const persistentDock = persistentDocks.find(dock => dock.isMain) ??
            persistentDocks.find(dock => dock.monitorIndex === primaryIndex) ??
            persistentDocks[0];
        if (persistentDock) {
            return {
                dash: persistentDock.dash,
                container: persistentDock.dash._dashContainer,
                side: persistentDock.position ?? St.Side.BOTTOM,
                persistent: true,
            };
        }

        const dash = Main.overview.dash;
        if (!dash?._dashContainer)
            return null;
        return {
            dash,
            container: dash._dashContainer,
            side: St.Side.BOTTOM,
            persistent: false,
        };
    }

    _createIndicator(target) {
        const {dash, container, side, persistent = false} = target;
        this._indicatorDash = dash;
        this._indicatorContainer = container;

        this._dashItem = new Dash.DashItemContainer();
        this._indicator = new PanelMenu.Button(0.5, 'Gnome美化', false);
        this._indicator.remove_style_class_name('panel-button');
        this._indicator.add_style_class_name('gnome-beautify-dash-button');
        this._indicator.setMenu(new PopupMenu.PopupMenu(
            this._indicator, 0.5, side));
        if (persistent) {
            this._indicator.menu.connect('open-state-changed', (_menu, open) => {
                if (dash.get_stage?.())
                    dash.emit(open ? 'menu-opened' : 'menu-closed');
            });
        }

        const iconPath = `${this.path}/icons/gnome-beautify-symbolic.svg`;
        this._indicatorIcon = new St.Icon({
            gicon: Gio.icon_new_for_string(iconPath),
            icon_size: this._dashIconSize(dash),
        });
        this._indicator.add_child(this._indicatorIcon);

        this._dashItem.setChild(this._indicator);
        this._dashItem.setLabelText('Gnome美化');
        const position = Math.max(1, container.get_n_children() - 1);
        container.insert_child_at_index(this._dashItem, position);
        this._dashItem.show(false);

        dash.connectObject('icon-size-changed', () => {
            if (this._indicatorIcon)
                this._indicatorIcon.icon_size = this._dashIconSize(dash);
        }, this._dashItem);
        const dashItem = this._dashItem;
        dashItem.connect('destroy', () => {
            if (this._dashItem !== dashItem)
                return;
            this._dashItem = null;
            this._indicator = null;
            this._indicatorIcon = null;
            this._indicatorDash = null;
            this._indicatorContainer = null;
            this._quickEffectItems = null;
            this._quickOpacitySlider = null;
            this._quickRadiusSlider = null;
            if (!this._destroyingIndicator) {
                this._scheduleIndicatorSync();
            }
        });
        this._rebuildQuickMenu();
    }

    _dashIconSize(dash = this._indicatorDash ?? Main.overview.dash) {
        return Math.max(22, (dash.iconSize ?? dash._iconSize ?? 48) - 10);
    }

    _destroyIndicator() {
        this._destroyingIndicator = true;
        if (this._indicator)
            this._indicator.setMenu(null);
        this._dashItem?.destroy();
        this._destroyingIndicator = false;
        this._dashItem = null;
        this._indicator = null;
        this._indicatorIcon = null;
        this._indicatorDash = null;
        this._indicatorContainer = null;
        this._quickEffectItems = null;
        this._quickOpacitySlider = null;
        this._quickRadiusSlider = null;
    }

    _rebuildQuickMenu() {
        if (!this._indicator?.menu)
            return;

        const _ = this._;
        const menu = this._indicator.menu;
        menu.removeAll();

        const title = new PopupMenu.PopupMenuItem('Gnome美化', {
            reactive: false,
            can_focus: false,
        });
        title.label.add_style_class_name('gnome-beautify-menu-title');
        menu.addMenuItem(title);

        const caption = new PopupMenu.PopupMenuItem(
            _('同时应用到 Dock 与应用程序栏'), {
                reactive: false,
                can_focus: false,
            });
        caption.label.add_style_class_name('gnome-beautify-menu-caption');
        menu.addMenuItem(caption);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('快速效果')));

        const names = {
            original: _('原始'),
            transparent: _('透明'),
            blur: _('模糊'),
        };
        this._quickEffectItems = new Map();
        for (const effect of QUICK_EFFECTS) {
            const item = new PopupMenu.PopupMenuItem(names[effect]);
            item.connect('activate', () => this._setQuickEffect(effect));
            menu.addMenuItem(item);
            this._quickEffectItems.set(effect, item);
        }

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._quickOpacitySlider = this._createSliderItem(
            _('透明度'), 0, 100, 'dock-opacity', value => `${value}%`);
        menu.addMenuItem(this._quickOpacitySlider.item);
        this._quickRadiusSlider = this._createSliderItem(
            _('半径'), 0, 80, 'dock-blur-radius', value => `${value} px`);
        menu.addMenuItem(this._quickRadiusSlider.item);

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction(_('打开设置'), () => {
            Main.overview.hide();
            this.openPreferences();
        }, 'emblem-system-symbolic');
        this._updateQuickMenu();
    }

    _createSliderItem(labelText, min, max, settingKey, formatter) {
        const item = new PopupMenu.PopupBaseMenuItem({
            activate: false,
            can_focus: false,
        });
        const box = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'gnome-beautify-slider-box',
        });
        const heading = new St.BoxLayout({
            x_expand: true,
            style_class: 'gnome-beautify-slider-heading',
        });
        const label = new St.Label({text: labelText, x_expand: true});
        const valueLabel = new St.Label({style_class: 'gnome-beautify-slider-value'});
        heading.add_child(label);
        heading.add_child(valueLabel);

        const normalized = (this._settings.get_int(settingKey) - min) / (max - min);
        const slider = new Slider.Slider(normalized);
        slider.x_expand = true;
        valueLabel.text = formatter(this._settings.get_int(settingKey));
        slider.connect('notify::value', () => {
            if (this._updatingQuickMenu)
                return;
            const value = Math.round(min + slider.value * (max - min));
            valueLabel.text = formatter(value);
            this._settings.set_int(`dock-${settingKey.replace(/^dock-/, '')}`, value);
            if (!this._settings.get_boolean('linked-targets'))
                this._settings.set_int(`app-${settingKey.replace(/^dock-/, '')}`, value);
        });

        box.add_child(heading);
        box.add_child(slider);
        item.add_child(box);
        return {item, slider, valueLabel, min, max, settingKey, formatter};
    }

    _setQuickEffect(effect) {
        this._settings.set_string('dock-effect', effect);
        if (!this._settings.get_boolean('linked-targets'))
            this._settings.set_string('app-effect', effect);
        this._updateQuickMenu();
    }

    _updateQuickMenu() {
        if (!this._quickEffectItems)
            return;

        this._updatingQuickMenu = true;
        const effect = this._settings.get_string('dock-effect');
        for (const [name, item] of this._quickEffectItems)
            item.setOrnament(name === effect
                ? PopupMenu.Ornament.DOT
                : PopupMenu.Ornament.NONE);

        for (const control of [this._quickOpacitySlider, this._quickRadiusSlider]) {
            if (!control)
                continue;
            const value = this._settings.get_int(control.settingKey);
            control.slider.value = (value - control.min) / (control.max - control.min);
            control.valueLabel.text = control.formatter(value);
        }
        this._quickRadiusSlider?.item.setSensitive?.(
            effect === 'blur' || effect === 'glass');
        this._updatingQuickMenu = false;
    }

    _applyEffects(snapshot = this._committedSnapshot) {
        if (!snapshot || !this._enabled)
            return;
        const actors = [];
        if (Main.panel)
            actors.push(['dock', Main.panel, Main.layoutManager.panelBox]);
        this._missingTargets.clear();
        for (const dock of this._findPersistentDocks()) {
            const background = dock.dash?._background ??
                dock.dash?.get_children?.().find(child =>
                    child.has_style_class_name?.('dash-background'));
            if (background)
                actors.push(['app', background, dock.dash]);
            else
                this._missingTargets.add('app');
        }
        const overviewDash = Main.overview.dash;
        if (overviewDash?._background) {
            // ControlsManager uses a custom layout which does not allocate
            // unknown children. Attach outside it, in overviewGroup's fixed
            // layout, and outside Dash's redirected framebuffer as well.
            let anchor = overviewDash;
            const overviewGroup = Main.layoutManager.overviewGroup;
            while (anchor.get_parent() && anchor.get_parent() !== overviewGroup &&
                anchor.get_parent() !== Main.uiGroup)
                anchor = anchor.get_parent();
            actors.push(['app', overviewDash._background, anchor]);
        }

        const activeActors = new Set();
        this._targetStates.clear();
        const environment = {
            isDark: this._isDarkTheme(),
            animating: snapshot.performanceProtection && this._overviewAnimating,
            battery: snapshot.batteryReduce && this._onBattery,
        };

        this._applying = true;
        try {
            for (const [target, actor, anchor] of actors) {
                if (!actor || activeActors.has(actor))
                    continue;
                activeActors.add(actor);
                const state = {target, state: 'waiting', configured: false};
                this._targetStates.set(actor, state);
                try {
                    this._captureActor(actor);
                    this._applyActor(actor, snapshot[target], anchor, environment);
                    state.configured = true;
                    state.state = this._actorState(actor);
                } catch (error) {
                    state.state = 'failed';
                    console.warn(`${this.uuid}: ${target} background could not apply: ${error.message}`);
                }
            }
            for (const target of ['dock', 'app']) {
                if (![...this._targetStates.values()].some(item => item.target === target))
                    this._missingTargets.add(target);
            }
            this._pruneActors(activeActors);
        } finally {
            this._applying = false;
        }
        this._updateRetryState();
    }

    _actorState(actor) {
        if (this._targetStates.get(actor)?.configured === false)
            return 'failed';
        const record = this._originalActors.get(actor);
        if (record?.managed && actor.get_style() !== record.expectedStyle)
            return 'failed';
        if (!actor.is_mapped())
            return 'hidden';
        if (!actor.has_allocation())
            return 'waiting';
        return this._blurSurfaces.get(actor)?.state ?? 'applied';
    }

    _updateRetryState() {
        if (this._applying)
            return;
        const needsRetry = this._missingTargets.size > 0 ||
            [...this._targetStates.values()].some(item => ['failed', 'waiting'].includes(item.state));
        if (needsRetry)
            this._scheduleRetry();
        else {
            if (this._retrySource)
                GLib.Source.remove(this._retrySource);
            this._retrySource = 0;
            this._retryAttempt = 0;
        }
        this._publishStatus();
    }

    _captureActor(actor) {
        if (this._originalActors.has(actor))
            return;
        const record = {
            actor,
            style: actor.get_style(),
            clipToAllocation: actor.clip_to_allocation,
            managed: false,
            writing: false,
            repairAttempts: 0,
            repairWindow: 0,
            signals: [],
        };
        this._originalActors.set(actor, record);
        record.signals.push(actor.connect('notify::style', () => {
            if (record.writing)
                return;
            if (!record.managed) {
                record.style = actor.get_style();
                return;
            }
            if (actor.get_style() === record.expectedStyle)
                return;
            record.style = actor.get_style();
            const state = this._targetStates.get(actor);
            if (state)
                state.state = 'failed';
            // Bound repairs if another style owner immediately undoes ours.
            if (Date.now() - record.repairWindow > 2000) {
                record.repairWindow = Date.now();
                record.repairAttempts = 0;
            }
            if (++record.repairAttempts <= 3)
                this._queueFrameRefresh();
            this._publishStatus();
        }));
        for (const signal of ['notify::mapped', 'notify::allocation']) {
            record.signals.push(actor.connect(signal, () => {
                const state = this._targetStates.get(actor);
                if (!state)
                    return;
                // Non-blur effects also need accurate visibility/allocation
                // status. Do not hide an earlier attachment failure here.
                if (state.state !== 'failed')
                    state.state = this._actorState(actor);
                if (actor.is_mapped() && ['waiting', 'failed'].includes(state.state))
                    this._queueRefresh();
                this._updateRetryState();
            }));
        }
        record.signals.push(actor.connect('destroy', () => {
            this._removeBlurSurface(actor);
            this._originalActors.delete(actor);
            this._targetStates?.delete(actor);
            this._queueRefresh();
        }));
    }

    _writeActorStyle(actor, style) {
        const record = this._originalActors.get(actor);
        record.expectedStyle = style;
        record.writing = true;
        try {
            if (actor.get_style() !== style)
                actor.set_style(style);
        } finally {
            record.writing = false;
        }
        // A host theme handler may synchronously replace the style during
        // notify::style. Keep its replacement for restoration, not our own.
        if (record.managed && actor.get_style() !== style)
            record.style = actor.get_style();
    }

    _applyActor(actor, config, anchor, environment) {
        this._removeBlur(actor);
        const effect = config.effect;
        const original = this._originalActors.get(actor);
        original.managed = effect !== 'original';
        if (effect === 'original') {
            this._removeBlurSurface(actor);
            this._writeActorStyle(actor, original?.style ?? null);
            actor.clip_to_allocation = original?.clipToAllocation ?? false;
            return;
        }

        const transparency = config.opacity / 100;
        const backgroundAlpha = Math.max(0, 1 - transparency);
        const corner = config['corner-radius'];
        const border = config['border-width'];
        const shadow = config['shadow-strength'] / 100;
        const {isDark} = environment;
        const base = original?.style ? `${original.style};` : '';
        const details = [
            `border-radius: ${corner}px`,
            // Only our managed backgrounds opt out of the theme's 250ms
            // transition to/from its default black panel. Original restores it.
            'transition-duration: 0ms',
        ];
        actor.clip_to_allocation = effect === 'blur' || effect === 'glass';

        if (effect === 'transparent') {
            const transparentColor = isDark ? '30,30,34' : '248,248,250';
            details.push(
                `background-color: rgba(${transparentColor},${backgroundAlpha.toFixed(2)})`,
                'border-width: 0px',
                'border-color: rgba(0,0,0,0)',
                'box-shadow: none');
        } else {
            const borderColor = isDark ? '255,255,255' : '0,0,0';
            details.push(
                `border-width: ${border}px`,
                `border-color: rgba(${borderColor},${Math.min(0.34, backgroundAlpha * 0.32).toFixed(2)})`,
                `box-shadow: 0 6px 20px rgba(0,0,0,${(shadow * backgroundAlpha).toFixed(2)})`);
        }

        if (effect === 'solid')
            details.push(`background-color: ${this._rgba(config.color, backgroundAlpha)}`);
        else if (effect === 'gradient') {
            const direction = config['gradient-direction'];
            const orientation = direction >= 45 && direction < 225 ? 'horizontal' : 'vertical';
            details.push(
                `background-gradient-direction: ${orientation}`,
                `background-gradient-start: ${this._rgba(config['gradient-start'], backgroundAlpha)}`,
                `background-gradient-end: ${this._rgba(config['gradient-end'], backgroundAlpha)}`);
        } else if (effect === 'blur' || effect === 'glass') {
            const tint = effect === 'glass'
                ? config.tint / 100
                : 0;
            const neutral = isDark ? [48, 46, 56] : [238, 238, 244];
            const glassTint = isDark ? [102, 82, 126] : [176, 158, 202];
            const red = Math.round(neutral[0] * (1 - tint) + glassTint[0] * tint);
            const green = Math.round(neutral[1] * (1 - tint) + glassTint[1] * tint);
            const blue = Math.round(neutral[2] * (1 - tint) + glassTint[2] * tint);
            details.push(`background-color: rgba(${red},${green},${blue},${backgroundAlpha.toFixed(2)})`);
            if (effect === 'glass') {
                const glassBorder = isDark
                    ? `255,255,255,${(0.24 * backgroundAlpha).toFixed(2)}`
                    : `0,0,0,${(0.16 * backgroundAlpha).toFixed(2)}`;
                details.push(
                    `border-color: rgba(${glassBorder})`,
                    'box-shadow: none');
            }

            let radius = config['blur-radius'];
            let brightness = effect === 'glass'
                ? 1
                : config.brightness / 100;
            if (environment.animating)
                radius = Math.round(radius * 0.55);
            if (environment.battery) {
                radius = Math.round(radius * 0.65);
                if (effect === 'blur')
                    brightness = Math.min(brightness, 0.92);
            }
            if (backgroundAlpha > 0.001)
                this._ensureBlurSurface(actor, anchor, radius, brightness, corner);
        }

        if ((effect !== 'blur' && effect !== 'glass') || backgroundAlpha <= 0.001)
            this._removeBlurSurface(actor);

        this._writeActorStyle(actor, `${base}${details.join(';')};`);
    }

    _ensureBlurSurface(actor, anchor, radius, brightness, corner) {
        let layer = this._blurSurfaces.get(actor);
        if (layer && !layer.matches(actor, anchor)) {
            this._removeBlurSurface(actor);
            layer = null;
        }

        if (!layer) {
            layer = new BackgroundBlurLayer(actor, anchor,
                global.compositor.get_laters(), destroyedLayer => {
                    if (this._blurSurfaces?.get(actor) === destroyedLayer) {
                        this._blurSurfaces.delete(actor);
                        const state = this._targetStates.get(actor);
                        if (state)
                            state.state = 'waiting';
                        this._queueRefresh();
                    }
                }, (updatedLayer, state) => {
                    const targetState = this._targetStates?.get(actor);
                    if (targetState && this._blurSurfaces?.get(actor) === updatedLayer) {
                        targetState.state = !targetState.configured ? 'failed'
                            : state === 'applied' ? this._actorState(actor) : state;
                        this._updateRetryState();
                    }
                });
            this._blurSurfaces.set(actor, layer);
        }
        layer.update(radius, brightness, corner);
    }

    _removeBlurSurface(actor) {
        const layer = this._blurSurfaces?.get(actor);
        if (!layer)
            return;
        this._blurSurfaces.delete(actor);
        layer.destroy();
    }

    _pruneActors(activeActors) {
        for (const [actor, original] of this._originalActors) {
            if (activeActors.has(actor))
                continue;
            this._removeBlurSurface(actor);
            try {
                original.managed = false;
                for (const id of original.signals)
                    actor.disconnect(id);
                this._removeBlur(actor);
                actor.set_style(original.style ?? null);
                actor.clip_to_allocation = original.clipToAllocation;
            } catch (error) {
                console.debug(`${this.uuid}: stale actor already unavailable: ${error.message}`);
            }
            this._originalActors.delete(actor);
        }
    }

    _rgba(hex, alpha) {
        const match = /^#?([0-9a-f]{6})$/i.exec(hex);
        if (!match)
            return `rgba(48,48,52,${alpha.toFixed(2)})`;
        const value = Number.parseInt(match[1], 16);
        const red = value >> 16;
        const green = value >> 8 & 0xff;
        const blue = value & 0xff;
        return `rgba(${red},${green},${blue},${alpha.toFixed(2)})`;
    }

    _isDarkTheme() {
        const scheme = this._interfaceSettings?.get_string('color-scheme') ?? '';
        if (scheme.includes('dark'))
            return true;
        if (scheme.includes('light'))
            return false;
        const theme = this._interfaceSettings?.get_string('gtk-theme') ?? '';
        return theme.toLowerCase().includes('dark');
    }

    _removeBlur(actor) {
        const blur = actor.get_effect(BLUR_EFFECT_NAME);
        if (blur)
            actor.remove_effect(blur);
    }

    _restoreActors() {
        for (const actor of [...(this._blurSurfaces?.keys() ?? [])])
            this._removeBlurSurface(actor);
        for (const record of this._originalActors?.values() ?? []) {
            const {actor, style, clipToAllocation} = record;
            try {
                record.managed = false;
                for (const id of record.signals)
                    actor.disconnect(id);
                this._removeBlur(actor);
                actor.set_style(style ?? null);
                actor.clip_to_allocation = clipToAllocation;
            } catch (error) {
                console.debug(`${this.uuid}: actor already unavailable: ${error.message}`);
            }
        }
        this._originalActors?.clear();
    }
}
