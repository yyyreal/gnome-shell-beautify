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
        this._applySource = 0;
        this._animationSource = 0;
        this._settingsChangedId = this._settings.connect('changed',
            (_settings, key) => this._onSettingChanged(key));

        this._overviewSignalIds = [
            Main.overview.connect('showing', () => this._beginOverviewAnimation()),
            Main.overview.connect('hiding', () => this._beginOverviewAnimation()),
        ];

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

        if (this._powerProxy && this._powerChangedId)
            this._powerProxy.disconnect(this._powerChangedId);
        this._powerChangedId = 0;
        this._powerProxy = null;

        this._destroyIndicator();
        this._restoreActors();
        this._originalActors = null;
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
        if (shouldShow && !this._dashItem)
            this._createIndicator();
        else if (!shouldShow && this._dashItem)
            this._destroyIndicator();
    }

    _createIndicator() {
        const dash = Main.overview.dash;
        if (!dash?._dashContainer)
            return;

        this._dashItem = new Dash.DashItemContainer();
        this._indicator = new PanelMenu.Button(0.5, 'Gnome美化', false);
        this._indicator.remove_style_class_name('panel-button');
        this._indicator.add_style_class_name('gnome-beautify-dash-button');
        this._indicator.setMenu(new PopupMenu.PopupMenu(
            this._indicator, 0.5, St.Side.BOTTOM));

        const iconPath = `${this.path}/icons/gnome-beautify-symbolic.svg`;
        this._indicatorIcon = new St.Icon({
            gicon: Gio.icon_new_for_string(iconPath),
            icon_size: this._dashIconSize(),
        });
        this._indicator.add_child(this._indicatorIcon);

        this._dashItem.setChild(this._indicator);
        this._dashItem.setLabelText('Gnome美化');
        const position = Math.max(1, dash._dashContainer.get_n_children() - 1);
        dash._dashContainer.insert_child_at_index(this._dashItem, position);
        this._dashItem.show(false);

        this._dashIconSizeId = dash.connect('icon-size-changed', () => {
            if (this._indicatorIcon)
                this._indicatorIcon.icon_size = this._dashIconSize();
        });
        this._rebuildQuickMenu();
    }

    _dashIconSize() {
        const dash = Main.overview.dash;
        return Math.max(22, (dash.iconSize ?? dash._iconSize ?? 48) - 10);
    }

    _destroyIndicator() {
        const dash = Main.overview.dash;
        if (dash && this._dashIconSizeId)
            dash.disconnect(this._dashIconSizeId);
        this._dashIconSizeId = 0;

        if (this._indicator)
            this._indicator.setMenu(null);
        this._dashItem?.destroy();
        this._dashItem = null;
        this._indicator = null;
        this._indicatorIcon = null;
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
            _('强度'), 0, 100, 'dock-opacity', value => `${value}%`);
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
        const actors = [
            ['dock', Main.panel],
            ['app', Main.overview.dash?._background],
        ];
        const linked = this._settings.get_boolean('linked-targets');

        for (const [target, actor] of actors) {
            if (!actor)
                continue;
            this._captureActor(target, actor);
            const prefix = target === 'app' && linked ? 'dock' : target;
            this._applyActor(target, actor, prefix);
        }
    }

    _captureActor(target, actor) {
        const current = this._originalActors.get(target);
        if (current?.actor === actor)
            return;
        this._originalActors.set(target, {
            actor,
            style: actor.get_style(),
        });
    }

    _applyActor(target, actor, prefix) {
        this._removeBlur(actor);
        const effect = this._settings.get_string(`${prefix}-effect`);
        const original = this._originalActors.get(target);
        if (effect === 'original') {
            actor.set_style(original?.style ?? null);
            return;
        }

        const opacity = this._settings.get_int(`${prefix}-opacity`) / 100;
        const corner = this._settings.get_int(`${prefix}-corner-radius`);
        const border = this._settings.get_int(`${prefix}-border-width`);
        const shadow = this._settings.get_int(`${prefix}-shadow-strength`) / 100;
        const base = original?.style ? `${original.style};` : '';
        const details = [
            `border-radius: ${corner}px`,
        ];

        if (effect === 'transparent') {
            const backgroundAlpha = Math.max(0, 1 - opacity);
            details.push(
                `background-color: rgba(30,30,34,${backgroundAlpha.toFixed(2)})`,
                'border-width: 0px',
                'border-color: rgba(0,0,0,0)',
                'box-shadow: none');
        } else {
            details.push(
                `border-width: ${border}px`,
                `border-color: rgba(255,255,255,${Math.min(0.34, opacity * 0.32).toFixed(2)})`,
                `box-shadow: 0 6px 20px rgba(0,0,0,${shadow.toFixed(2)})`);
        }

        if (effect === 'solid')
            details.push(`background-color: ${this._rgba(this._settings.get_string(`${prefix}-color`), opacity)}`);
        else if (effect === 'gradient') {
            const direction = this._settings.get_int(`${prefix}-gradient-direction`);
            const orientation = direction >= 45 && direction < 225 ? 'horizontal' : 'vertical';
            details.push(
                `background-gradient-direction: ${orientation}`,
                `background-gradient-start: ${this._rgba(this._settings.get_string(`${prefix}-gradient-start`), opacity)}`,
                `background-gradient-end: ${this._rgba(this._settings.get_string(`${prefix}-gradient-end`), opacity)}`);
        } else if (effect === 'blur' || effect === 'glass') {
            const tint = effect === 'glass'
                ? this._settings.get_int(`${prefix}-tint`) / 100
                : 0;
            const red = Math.round(38 + tint * 70);
            const green = Math.round(34 + tint * 48);
            const blue = Math.round(45 + tint * 92);
            details.push(`background-color: rgba(${red},${green},${blue},${opacity.toFixed(2)})`);
            if (effect === 'glass')
                details.push('border-color: rgba(255,255,255,0.28)');

            let radius = this._settings.get_int(`${prefix}-blur-radius`);
            let brightness = this._settings.get_int(`${prefix}-brightness`) / 100;
            if (this._overviewAnimating)
                radius = Math.round(radius * 0.55);
            if (this._onBattery && this._settings.get_boolean('battery-reduce')) {
                radius = Math.round(radius * 0.65);
                brightness = Math.min(brightness, 0.92);
            }
            actor.add_effect_with_name(BLUR_EFFECT_NAME, new Shell.BlurEffect({
                mode: Shell.BlurMode.BACKGROUND,
                radius,
                brightness,
            }));
        }

        actor.set_style(`${base}${details.join(';')};`);
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

    _removeBlur(actor) {
        const blur = actor.get_effect(BLUR_EFFECT_NAME);
        if (blur)
            actor.remove_effect(blur);
    }

    _restoreActors() {
        for (const {actor, style} of this._originalActors?.values() ?? []) {
            try {
                this._removeBlur(actor);
                actor.set_style(style ?? null);
            } catch (error) {
                console.debug(`${this.uuid}: actor already unavailable: ${error.message}`);
            }
        }
    }
}
