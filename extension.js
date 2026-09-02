import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Dash from 'resource:///org/gnome/shell/ui/dash.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

import {getTranslator} from './i18n.js';

const BLUR_EFFECT_NAME = 'gnome-beautify-background-blur';
const QUICK_EFFECTS = ['original', 'transparent', 'blur'];
const CONFIG_SUFFIXES = [
    'effect', 'blur-radius', 'opacity', 'brightness', 'tint', 'color',
    'gradient-start', 'gradient-end', 'gradient-direction',
    'corner-radius', 'border-width', 'shadow-strength',
];

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
        this._applySource = 0;
        this._animationSource = 0;
        this._settingsChangedId = this._settings.connect('changed',
            (_settings, key) => this._onSettingChanged(key));

        this._overviewSignalIds = [
            Main.overview.connect('showing', () => this._beginOverviewAnimation()),
            Main.overview.connect('hiding', () => this._beginOverviewAnimation()),
        ];
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
                () => this._scheduleApply(true)),
            this._interfaceSettings.connect('changed::gtk-theme',
                () => this._scheduleApply(true)),
        ];
        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
        this._themeChangedId = this._themeContext.connect('changed',
            () => this._scheduleApply(true));

        this._overviewAnimating = false;
        this._onBattery = false;
        this._setupPowerMonitor();
        this._syncIndicator();
        this._applyEffects();
    }

    disable() {
        if (this._applySource) {
            GLib.Source.remove(this._applySource);
            this._applySource = 0;
        }
        if (this._animationSource) {
            GLib.Source.remove(this._animationSource);
            this._animationSource = 0;
        }

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
        this._originalActors = null;
        this._blurSurfaces = null;
        this._settings = null;
        this._ = null;
    }

    _onSettingChanged(key) {
        if (key === 'language-mode') {
            this._ = getTranslator(this._settings);
            this._rebuildQuickMenu();
        }

        if (key === 'show-indicator')
            this._syncIndicator();

        this._updateQuickMenu();
        this._scheduleApply();
    }

    _scheduleApply(immediate = false) {
        if (this._applySource) {
            GLib.Source.remove(this._applySource);
            this._applySource = 0;
        }

        if (immediate) {
            this._applyEffects();
            return;
        }

        const delay = this._settings.get_int('apply-delay');
        this._applySource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._applySource = 0;
            this._applyEffects();
            return GLib.SOURCE_REMOVE;
        });
    }

    _beginOverviewAnimation() {
        if (!this._settings.get_boolean('performance-protection'))
            return;

        this._overviewAnimating = true;
        this._scheduleApply(true);
        if (this._animationSource)
            GLib.Source.remove(this._animationSource);

        this._animationSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 420, () => {
            this._animationSource = 0;
            this._overviewAnimating = false;
            this._scheduleApply(true);
            return GLib.SOURCE_REMOVE;
        });
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
                    this._scheduleApply(true);
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
                this._syncIndicator();
                this._applyEffects();
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
                this._scheduleApply();
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
            this._settings.set_int(`app-${settingKey.replace(/^dock-/, '')}`, value);
        });

        box.add_child(heading);
        box.add_child(slider);
        item.add_child(box);
        return {item, slider, valueLabel, min, max, settingKey, formatter};
    }

    _setQuickEffect(effect) {
        this._settings.set_string('dock-effect', effect);
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

    _applyEffects() {
        const actors = [];
        if (Main.panel)
            actors.push(['dock', Main.panel]);
        if (Main.overview.dash?._background)
            actors.push(['app', Main.overview.dash._background]);
        for (const dock of this._findPersistentDocks()) {
            const background = dock.dash?._background ??
                dock.dash?.get_children?.().find(child =>
                    child.has_style_class_name?.('dash-background'));
            if (background)
                actors.push(['app', background]);
        }

        const linked = this._settings.get_boolean('linked-targets');
        const activeActors = new Set();

        for (const [target, actor] of actors) {
            if (!actor || activeActors.has(actor))
                continue;
            activeActors.add(actor);
            this._captureActor(actor);
            const prefix = target === 'app' && linked ? 'dock' : target;
            this._applyActor(actor, prefix);
        }
        this._pruneActors(activeActors);
    }

    _captureActor(actor) {
        if (this._originalActors.has(actor))
            return;
        this._originalActors.set(actor, {
            actor,
            style: actor.get_style(),
            clipToAllocation: actor.clip_to_allocation,
        });
    }

    _applyActor(actor, prefix) {
        this._removeBlur(actor);
        const effect = this._settings.get_string(`${prefix}-effect`);
        const original = this._originalActors.get(actor);
        if (effect === 'original') {
            this._removeBlurSurface(actor);
            actor.set_style(original?.style ?? null);
            actor.clip_to_allocation = original?.clipToAllocation ?? false;
            return;
        }

        const transparency = this._settings.get_int(`${prefix}-opacity`) / 100;
        const backgroundAlpha = Math.max(0, 1 - transparency);
        const corner = this._settings.get_int(`${prefix}-corner-radius`);
        const border = this._settings.get_int(`${prefix}-border-width`);
        const shadow = this._settings.get_int(`${prefix}-shadow-strength`) / 100;
        const isDark = this._isDarkTheme();
        const base = original?.style ? `${original.style};` : '';
        const details = [
            `border-radius: ${corner}px`,
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
            details.push(`background-color: ${this._rgba(this._settings.get_string(`${prefix}-color`), backgroundAlpha)}`);
        else if (effect === 'gradient') {
            const direction = this._settings.get_int(`${prefix}-gradient-direction`);
            const orientation = direction >= 45 && direction < 225 ? 'horizontal' : 'vertical';
            details.push(
                `background-gradient-direction: ${orientation}`,
                `background-gradient-start: ${this._rgba(this._settings.get_string(`${prefix}-gradient-start`), backgroundAlpha)}`,
                `background-gradient-end: ${this._rgba(this._settings.get_string(`${prefix}-gradient-end`), backgroundAlpha)}`);
        } else if (effect === 'blur' || effect === 'glass') {
            const tint = effect === 'glass'
                ? this._settings.get_int(`${prefix}-tint`) / 100
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

            let radius = this._settings.get_int(`${prefix}-blur-radius`);
            let brightness = effect === 'glass'
                ? 1
                : this._settings.get_int(`${prefix}-brightness`) / 100;
            if (this._overviewAnimating)
                radius = Math.round(radius * 0.55);
            if (this._onBattery && this._settings.get_boolean('battery-reduce')) {
                radius = Math.round(radius * 0.65);
                if (effect === 'blur')
                    brightness = Math.min(brightness, 0.92);
            }
            if (backgroundAlpha > 0.001) {
                if (!this._ensureBlurSurface(actor, radius, brightness, corner)) {
                    actor.add_effect_with_name(BLUR_EFFECT_NAME, new Shell.BlurEffect({
                        mode: Shell.BlurMode.BACKGROUND,
                        radius,
                        brightness,
                    }));
                }
            }
        }

        if (effect !== 'blur' && effect !== 'glass' || backgroundAlpha <= 0.001)
            this._removeBlurSurface(actor);

        actor.set_style(`${base}${details.join(';')};`);
    }

    _ensureBlurSurface(actor, radius, brightness, corner) {
        const parent = actor.get_parent?.();
        if (!parent)
            return false;

        let surface = this._blurSurfaces.get(actor);
        if (surface?.get_parent?.() !== parent) {
            this._removeBlurSurface(actor);
            surface = null;
        }

        if (!surface) {
            surface = new St.Widget({
                reactive: false,
                can_focus: false,
                clip_to_allocation: true,
            });
            surface.add_constraint(new Clutter.BindConstraint({
                source: actor,
                coordinate: Clutter.BindCoordinate.ALL,
            }));
            parent.insert_child_below(surface, actor);
            this._blurSurfaces.set(actor, surface);
        } else {
            parent.set_child_below_sibling(surface, actor);
        }

        this._removeBlur(surface);
        surface.set_style([
            'background-color: rgba(0,0,0,0)',
            `border-radius: ${corner}px`,
            'border-width: 0px',
            'box-shadow: none',
        ].join(';') + ';');
        surface.add_effect_with_name(BLUR_EFFECT_NAME, new Shell.BlurEffect({
            mode: Shell.BlurMode.BACKGROUND,
            radius,
            brightness,
        }));
        return true;
    }

    _removeBlurSurface(actor) {
        const surface = this._blurSurfaces?.get(actor);
        if (!surface)
            return;
        this._blurSurfaces.delete(actor);
        try {
            this._removeBlur(surface);
            surface.destroy();
        } catch (error) {
            console.debug(`${this.uuid}: blur surface already unavailable: ${error.message}`);
        }
    }

    _pruneActors(activeActors) {
        for (const [actor, original] of this._originalActors) {
            if (activeActors.has(actor))
                continue;
            this._removeBlurSurface(actor);
            try {
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
        for (const {actor, style, clipToAllocation} of this._originalActors?.values() ?? []) {
            try {
                this._removeBlur(actor);
                actor.set_style(style ?? null);
                actor.clip_to_allocation = clipToAllocation;
            } catch (error) {
                console.debug(`${this.uuid}: actor already unavailable: ${error.message}`);
            }
        }
    }
}
