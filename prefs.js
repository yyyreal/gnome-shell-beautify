import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {getTranslator} from './i18n.js';

const EFFECTS = [
    ['original', '原始', 'document-properties-symbolic'],
    ['transparent', '透明', 'edit-clear-all-symbolic'],
    ['blur', '模糊', 'view-more-symbolic'],
    ['glass', '磨砂玻璃', 'weather-clear-night-symbolic'],
    ['solid', '纯色', 'color-select-symbolic'],
    ['gradient', '渐变', 'applications-graphics-symbolic'],
];

const TARGET_SUFFIXES = [
    'effect', 'blur-radius', 'opacity', 'brightness', 'tint', 'color',
    'gradient-start', 'gradient-end', 'gradient-direction',
    'corner-radius', 'border-width', 'shadow-strength',
];

const GLOBAL_KEYS = [
    'linked-targets', 'show-indicator', 'apply-delay', 'language-mode',
    'remember-last', 'performance-protection', 'battery-reduce',
];

const ALL_KEYS = [
    ...GLOBAL_KEYS,
    ...TARGET_SUFFIXES.map(key => `dock-${key}`),
    ...TARGET_SUFFIXES.map(key => `app-${key}`),
];

export default class GnomeBeautifyPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._window = window;
        this._settings = this.getSettings();
        this._ = getTranslator(this._settings);
        this._statusSources = new Map();
        this._appControls = [];

        window.set_default_size(980, 760);
        window.set_size_request(880, 620);
        window.search_enabled = false;
        this._loadCss(window);

        const pages = [
            ['general', this._('通用'), 'preferences-system-symbolic', this._buildGeneralPage()],
            ['dock', 'Dock', 'computer-symbolic', this._buildAppearancePage('dock')],
            ['app', this._('应用程序栏'), 'view-app-grid-symbolic', this._buildAppearancePage('app')],
            ['advanced', this._('高级'), 'applications-engineering-symbolic', this._buildAdvancedPage()],
            ['about', this._('关于'), 'help-about-symbolic', this._buildAboutPage()],
        ];
        window.set_content(this._buildWindowLayout(pages));

        this._linkedChangedId = this._settings.connect('changed::linked-targets',
            () => this._updateLinkedState());
        this._updateLinkedState();

        window.connect('close-request', () => {
            for (const sourceId of this._statusSources.values())
                GLib.Source.remove(sourceId);
            this._statusSources.clear();
            if (this._linkedChangedId)
                this._settings.disconnect(this._linkedChangedId);
            this._linkedChangedId = 0;
            if (this._cssProvider) {
                Gtk.StyleContext.remove_provider_for_display(
                    Gdk.Display.get_default(), this._cssProvider);
                this._cssProvider = null;
            }
            return false;
        });
    }

    _buildWindowLayout(pages) {
        const toolbar = new Adw.ToolbarView();
        const header = new Adw.HeaderBar();
        const titleBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 1,
            valign: Gtk.Align.CENTER,
        });
        const title = new Gtk.Label({label: 'Gnome美化'});
        title.add_css_class('title');
        const subtitle = new Gtk.Label({label: this._('Dock 与应用程序栏背景')});
        subtitle.add_css_class('subtitle');
        titleBox.append(title);
        titleBox.append(subtitle);
        header.title_widget = titleBox;
        toolbar.add_top_bar(header);

        const layout = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            hexpand: true,
            vexpand: true,
        });
        const sidebar = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            width_request: 205,
            vexpand: true,
        });
        sidebar.add_css_class('settings-sidebar');
        const navigation = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.SINGLE,
            activate_on_single_click: true,
            margin_top: 14,
            margin_start: 10,
            margin_end: 10,
        });
        navigation.add_css_class('navigation-sidebar');
        sidebar.append(navigation);

        const stack = new Gtk.Stack({
            hexpand: true,
            vexpand: true,
            transition_type: Gtk.StackTransitionType.CROSSFADE,
            transition_duration: 160,
        });
        let dockRow = null;
        for (const [name, label, iconName, page] of pages) {
            stack.add_named(page, name);
            const row = new Gtk.ListBoxRow({
                activatable: true,
                selectable: true,
            });
            row._pageName = name;
            row._pageTitle = label;
            const content = new Gtk.Box({
                spacing: 12,
                margin_top: 10,
                margin_bottom: 10,
                margin_start: 12,
                margin_end: 12,
            });
            content.append(new Gtk.Image({icon_name: iconName, pixel_size: 18}));
            content.append(new Gtk.Label({label, xalign: 0}));
            row.set_child(content);
            navigation.append(row);
            if (name === 'dock')
                dockRow = row;
        }
        navigation.connect('row-selected', (_list, row) => {
            if (!row)
                return;
            stack.visible_child_name = row._pageName;
            subtitle.set_label(row._pageName === 'general'
                ? this._('界面与行为')
                : row._pageName === 'about'
                    ? this._('关于')
                    : `${row._pageTitle} · ${this._('背景效果')}`);
        });
        navigation.select_row(dockRow);
        stack.visible_child_name = 'dock';

        layout.append(sidebar);
        const separator = new Gtk.Separator({orientation: Gtk.Orientation.VERTICAL});
        layout.append(separator);
        layout.append(stack);

        this._toastOverlay = new Adw.ToastOverlay();
        this._toastOverlay.set_child(layout);
        toolbar.set_content(this._toastOverlay);
        return toolbar;
    }

    _loadCss() {
        this._cssProvider = new Gtk.CssProvider();
        this._cssProvider.load_from_path(`${this.path}/prefs.css`);
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(),
            this._cssProvider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    }

    _buildGeneralPage() {
        const _ = this._;
        const page = new Adw.PreferencesPage({
            title: _('通用'),
            icon_name: 'preferences-system-symbolic',
        });
        const group = new Adw.PreferencesGroup({
            title: _('界面与行为'),
        });
        page.add(group);

        const languages = ['自动 / Automatic', '中文', 'English'];
        const languageValues = ['auto', 'zh', 'en'];
        const languageRow = new Adw.ComboRow({
            title: _('界面语言'),
            subtitle: _('自动选项会跟随系统语言；重新打开设置后生效'),
            model: Gtk.StringList.new(languages),
            selected: Math.max(0,
                languageValues.indexOf(this._settings.get_string('language-mode'))),
        });
        languageRow.connect('notify::selected', row => {
            this._settings.set_string('language-mode', languageValues[row.selected]);
        });
        group.add(languageRow);

        const delays = [500, 1000, 2000, 3000, 5000];
        const delayRow = new Adw.ComboRow({
            title: _('调整延迟'),
            subtitle: _('停止操作后再应用效果，避免连续重绘造成卡顿'),
            model: Gtk.StringList.new(['0.5 s', '1 s', '2 s', '3 s', '5 s']),
            selected: Math.max(0, delays.indexOf(this._settings.get_int('apply-delay'))),
        });
        delayRow.connect('notify::selected', row => {
            this._settings.set_int('apply-delay', delays[row.selected]);
        });
        group.add(delayRow);

        group.add(this._switchRow(
            'remember-last', _('记住最后一次效果'), _('登录后恢复上次使用的配置')));
        group.add(this._switchRow(
            'show-indicator', _('显示 Dock 快捷图标'), _('点击图标打开快捷菜单和设置')));
        return page;
    }

    _buildAppearancePage(prefix) {
        const _ = this._;
        const isDock = prefix === 'dock';
        const page = new Adw.PreferencesPage({
            title: isDock ? 'Dock' : _('应用程序栏'),
            icon_name: isDock ? 'computer-symbolic' : 'view-app-grid-symbolic',
        });

        if (isDock)
            page.add(this._buildScopeGroup());

        const statusRow = new Adw.ActionRow({
            title: _('停止调整后自动应用'),
            subtitle: `${this._settings.get_int('apply-delay') / 1000} s`,
        });
        statusRow.add_prefix(new Gtk.Image({icon_name: 'alarm-symbolic'}));

        const effectGroup = new Adw.PreferencesGroup({
            title: _('背景效果'),
            description: _('选择此区域使用的背景样式'),
        });
        const effectBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
        });
        effectBox.add_css_class('effect-grid');
        const flow = new Gtk.FlowBox({
            selection_mode: Gtk.SelectionMode.NONE,
            homogeneous: true,
            min_children_per_line: 3,
            max_children_per_line: 6,
            row_spacing: 8,
            column_spacing: 8,
        });
        effectBox.append(flow);
        effectGroup.add(effectBox);
        page.add(effectGroup);

        const currentEffect = this._settings.get_string(`${prefix}-effect`);
        let firstButton = null;
        let syncingEffect = false;
        const effectButtons = new Map();
        for (const [value, label, iconName] of EFFECTS) {
            const button = new Gtk.ToggleButton();
            button.add_css_class('effect-tile');
            if (firstButton)
                button.set_group(firstButton);
            else
                firstButton = button;
            const content = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 7,
                halign: Gtk.Align.CENTER,
                valign: Gtk.Align.CENTER,
            });
            content.append(this._buildEffectPreview(value, iconName));
            content.append(new Gtk.Label({label: _(label)}));
            button.set_child(content);
            button.active = currentEffect === value;
            button.connect('toggled', widget => {
                if (!widget.active || syncingEffect)
                    return;
                this._settings.set_string(`${prefix}-effect`, value);
                this._updateParameterVisibility(prefix, value);
                this._refreshLivePreview(prefix, value);
                this._markPending(statusRow);
            });
            flow.append(button);
            effectButtons.set(value, button);
        }
        const effectChangedId = this._settings.connect(`changed::${prefix}-effect`, () => {
            const value = this._settings.get_string(`${prefix}-effect`);
            syncingEffect = true;
            effectButtons.get(value)?.set_active(true);
            syncingEffect = false;
            this._updateParameterVisibility(prefix, value);
            this._refreshLivePreview(prefix, value);
        });
        effectBox.connect('destroy', () => {
            if (effectChangedId)
                this._settings?.disconnect(effectChangedId);
        });

        const parameterGroup = new Adw.PreferencesGroup({
            description: _('0% 为完全不透明，100% 为完全透明'),
        });
        page.add(parameterGroup);
        const livePreview = this._buildLivePreview(prefix, currentEffect);
        parameterGroup.add(livePreview.container);
        const rows = new Map();
        rows.set('radius', this._scaleRow(prefix, 'blur-radius', _('模糊半径'), 0, 80, 1, 'px', statusRow));
        rows.set('opacity', this._scaleRow(prefix, 'opacity', _('透明度'), 0, 100, 1, '%', statusRow));
        rows.set('brightness', this._scaleRow(prefix, 'brightness', _('亮度'), 40, 120, 1, '%', statusRow));
        rows.set('tint', this._scaleRow(prefix, 'tint', _('色调强度'), 0, 100, 1, '%', statusRow));
        rows.set('color', this._colorRow(prefix, 'color', _('背景颜色'), statusRow));
        rows.set('gradient-start', this._colorRow(prefix, 'gradient-start', _('起始颜色'), statusRow));
        rows.set('gradient-end', this._colorRow(prefix, 'gradient-end', _('结束颜色'), statusRow));
        rows.set('direction', this._scaleRow(prefix, 'gradient-direction', _('渐变方向'), 0, 360, 5, '°', statusRow));
        for (const row of rows.values())
            parameterGroup.add(row);

        const warningRow = new Adw.ActionRow({
            title: _('背景模糊可能增加 GPU 占用'),
        });
        warningRow.add_prefix(new Gtk.Image({icon_name: 'dialog-warning-symbolic'}));
        warningRow.add_css_class('warning-text');
        parameterGroup.add(warningRow);
        parameterGroup.add(statusRow);

        const detailGroup = new Adw.PreferencesGroup({title: _('外观细节')});
        detailGroup.add(this._scaleRow(prefix, 'corner-radius', _('圆角'), 0, 36, 1, 'px', statusRow));
        detailGroup.add(this._scaleRow(prefix, 'border-width', _('边框'), 0, 4, 1, 'px', statusRow));
        detailGroup.add(this._scaleRow(prefix, 'shadow-strength', _('阴影'), 0, 100, 1, '%', statusRow));
        page.add(detailGroup);

        const resetGroup = new Adw.PreferencesGroup();
        const resetRow = new Adw.ActionRow({
            title: _('恢复默认'),
            subtitle: isDock
                ? _('设置 Dock 顶部系统栏的背景样式')
                : _('设置概览中应用程序栏的背景样式'),
        });
        const resetButton = new Gtk.Button({
            label: _('恢复默认'),
            valign: Gtk.Align.CENTER,
        });
        resetButton.connect('clicked', () => {
            for (const suffix of TARGET_SUFFIXES)
                this._settings.reset(`${prefix}-${suffix}`);
            this._toast(_('设置已恢复默认值'));
        });
        resetRow.add_suffix(resetButton);
        resetGroup.add(resetRow);
        page.add(resetGroup);

        this[`_${prefix}Appearance`] = {
            page,
            groups: [effectGroup, parameterGroup, detailGroup, resetGroup],
            parameterGroup,
            rows,
            warningRow,
            effectButtons,
            livePreview,
        };
        if (!isDock)
            this._appControls.push(...this._appAppearance.groups);
        this._updateParameterVisibility(prefix, currentEffect);
        this._refreshLivePreview(prefix, currentEffect);
        return page;
    }

    _buildScopeGroup() {
        const _ = this._;
        const group = new Adw.PreferencesGroup({title: _('应用范围')});
        const linkRow = this._switchRow(
            'linked-targets', _('联动 Dock 与应用程序栏'), _('关闭后可分别设置两处效果'));
        linkRow.connect('notify::active', row => {
            if (row.active)
                this._copyDockToApplication();
        });
        group.add(linkRow);

        const cards = new Gtk.Grid({
            column_spacing: 10,
            row_spacing: 10,
            column_homogeneous: true,
            margin_top: 8,
            margin_bottom: 4,
        });
        const applicationCard = this._buildTargetCard(
            _('应用程序栏'), 'view-app-grid-symbolic',
            ['folder-symbolic', 'utilities-terminal-symbolic', 'text-x-generic-symbolic', 'view-app-grid-symbolic']);
        this._appLinkStatus = applicationCard.status;
        cards.attach(applicationCard.container, 0, 0, 1, 1);

        const dockCard = this._buildTargetCard(
            'Dock', 'computer-symbolic',
            ['view-more-symbolic', 'network-wireless-signal-excellent-symbolic', 'audio-volume-high-symbolic', 'battery-good-symbolic']);
        this._dockLinkStatus = dockCard.status;
        cards.attach(dockCard.container, 1, 0, 1, 1);
        group.add(cards);
        return group;
    }

    _buildTargetCard(title, iconName, previewIcons) {
        const container = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 10,
            hexpand: true,
        });
        container.add_css_class('target-card');

        const header = new Gtk.Box({spacing: 8});
        header.append(new Gtk.Image({icon_name: iconName, pixel_size: 18}));
        const titleLabel = new Gtk.Label({
            label: title,
            hexpand: true,
            xalign: 0,
        });
        titleLabel.add_css_class('heading');
        header.append(titleLabel);
        const status = new Gtk.Label({valign: Gtk.Align.CENTER});
        status.add_css_class('linked-status');
        header.append(status);
        container.append(header);

        const preview = new Gtk.Box({
            spacing: 10,
            halign: Gtk.Align.FILL,
            valign: Gtk.Align.CENTER,
            homogeneous: true,
        });
        preview.add_css_class('target-preview');
        for (const previewIcon of previewIcons)
            preview.append(new Gtk.Image({icon_name: previewIcon, pixel_size: 19}));
        container.append(preview);
        return {container, status};
    }

    _buildEffectPreview(effect, iconName) {
        const preview = new Gtk.Box({
            spacing: 6,
            halign: Gtk.Align.FILL,
            valign: Gtk.Align.CENTER,
            homogeneous: true,
        });
        preview.add_css_class('effect-preview');
        preview.add_css_class(`effect-${effect}`);
        for (let index = 0; index < 3; index++)
            preview.append(new Gtk.Image({icon_name: iconName, pixel_size: 14}));
        return preview;
    }

    _buildLivePreview(prefix, effect) {
        const container = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 10,
            margin_top: 8,
            margin_bottom: 8,
        });
        container.add_css_class('live-preview');

        const heading = new Gtk.Box({spacing: 8});
        const label = new Gtk.Label({
            label: this._('效果预览'),
            hexpand: true,
            xalign: 0,
        });
        label.add_css_class('heading');
        heading.append(label);
        const value = new Gtk.Label({xalign: 1});
        value.add_css_class('dim-label');
        heading.append(value);
        container.append(heading);

        const surface = new Gtk.Box({
            spacing: 10,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        surface.add_css_class('live-preview-surface');
        surface.add_css_class(`effect-${effect}`);
        const icons = prefix === 'dock'
            ? ['view-more-symbolic', 'network-wireless-signal-excellent-symbolic', 'audio-volume-high-symbolic', 'battery-good-symbolic']
            : ['folder-symbolic', 'utilities-terminal-symbolic', 'text-x-generic-symbolic', 'view-app-grid-symbolic'];
        for (const icon of icons)
            surface.append(new Gtk.Image({icon_name: icon, pixel_size: 20}));
        container.append(surface);
        return {container, surface, value};
    }

    _refreshLivePreview(prefix, requestedEffect = null) {
        const state = this[`_${prefix}Appearance`];
        if (!state?.livePreview)
            return;
        const effect = requestedEffect ?? this._settings.get_string(`${prefix}-effect`);
        for (const [name] of EFFECTS)
            state.livePreview.surface.remove_css_class(`effect-${name}`);
        state.livePreview.surface.add_css_class(`effect-${effect}`);
        const effectLabel = this._(EFFECTS.find(([name]) => name === effect)?.[1] ?? '原始');
        const opacity = this._settings.get_int(`${prefix}-opacity`);
        const radius = this._settings.get_int(`${prefix}-blur-radius`);
        state.livePreview.value.set_label(
            effect === 'blur' || effect === 'glass'
                ? `${effectLabel} · ${radius} px · ${opacity}%`
                : effect === 'original' ? effectLabel : `${effectLabel} · ${opacity}%`);
    }

    _buildAdvancedPage() {
        const _ = this._;
        const page = new Adw.PreferencesPage({
            title: _('高级'),
            icon_name: 'applications-engineering-symbolic',
        });
        const performance = new Adw.PreferencesGroup({title: _('性能')});
        performance.add(this._switchRow(
            'performance-protection', _('性能保护'), _('概览动画期间临时降低模糊半径')));
        performance.add(this._switchRow(
            'battery-reduce', _('电池模式下降低效果'), _('使用电池时优先降低 GPU 占用')));
        page.add(performance);

        const presets = new Adw.PreferencesGroup({title: _('预设与恢复')});
        presets.add(this._buttonRow(_('导出预设'), 'document-save-symbolic', () => this._exportPreset()));
        presets.add(this._buttonRow(_('导入预设'), 'document-open-symbolic', () => this._importPreset()));
        presets.add(this._buttonRow(_('恢复默认'), 'edit-undo-symbolic', () => {
            for (const key of ALL_KEYS)
                this._settings.reset(key);
            this._toast(_('设置已恢复默认值'));
        }, true));
        page.add(presets);
        return page;
    }

    _buildAboutPage() {
        const _ = this._;
        const page = new Adw.PreferencesPage({
            title: _('关于'),
            icon_name: 'help-about-symbolic',
        });
        const hero = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 10,
            margin_top: 28,
            margin_bottom: 18,
            halign: Gtk.Align.CENTER,
        });
        const logo = Gtk.Image.new_from_file(`${this.path}/icons/gnome-beautify-symbolic.svg`);
        logo.set_pixel_size(82);
        logo.add_css_class('about-logo');
        hero.append(logo);
        const title = new Gtk.Label({label: 'Gnome美化'});
        title.add_css_class('about-title');
        hero.append(title);
        const description = new Gtk.Label({
            label: _('为 GNOME Shell 的 Dock 与应用程序栏提供独立或联动的透明、模糊、磨砂、纯色与渐变背景效果。'),
            wrap: true,
            justify: Gtk.Justification.CENTER,
            max_width_chars: 62,
        });
        description.add_css_class('about-description');
        hero.append(description);
        const heroGroup = new Adw.PreferencesGroup();
        heroGroup.add(hero);
        page.add(heroGroup);

        const info = new Adw.PreferencesGroup();
        info.add(this._infoRow(_('版本'), '1.0.5'));
        info.add(this._infoRow(_('作者'), 'Real April'));
        const emailRow = new Adw.ActionRow({title: _('邮箱')});
        emailRow.add_suffix(new Gtk.LinkButton({
            label: 'c070533@qq.com ↗',
            uri: 'mailto:c070533@qq.com',
            valign: Gtk.Align.CENTER,
        }));
        info.add(emailRow);
        info.add(this._infoRow(_('本地化'), '中文 / English'));
        const githubRow = new Adw.ActionRow({title: _('项目主页')});
        githubRow.add_suffix(new Gtk.LinkButton({
            label: 'github.com/yyyreal/gnome-beautify.git ↗',
            uri: 'https://github.com/yyyreal/gnome-beautify.git',
            valign: Gtk.Align.CENTER,
        }));
        info.add(githubRow);
        page.add(info);
        return page;
    }

    _switchRow(key, title, subtitle) {
        const row = new Adw.SwitchRow({title, subtitle});
        this._settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _scaleRow(prefix, suffix, title, min, max, step, unit, statusRow) {
        const key = `${prefix}-${suffix}`;
        const row = new Adw.ActionRow({title});
        const box = new Gtk.Box({
            spacing: 10,
            valign: Gtk.Align.CENTER,
        });
        const adjustment = new Gtk.Adjustment({
            lower: min,
            upper: max,
            step_increment: step,
            page_increment: Math.max(step, Math.round((max - min) / 10)),
            value: this._settings.get_int(key),
        });
        const scale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment,
            draw_value: false,
            hexpand: true,
        });
        scale.add_css_class('parameter-scale');
        const output = new Gtk.Label({
            label: `${this._settings.get_int(key)} ${unit}`.trim(),
            width_chars: 6,
            xalign: 1,
        });
        output.add_css_class('numeric-value');
        let syncing = false;
        adjustment.connect('value-changed', widget => {
            const value = Math.round(widget.get_value());
            output.set_label(`${value} ${unit}`.trim());
            if (syncing)
                return;
            this._settings.set_int(key, value);
            this._refreshLivePreview(prefix);
            this._markPending(statusRow);
        });
        const changedId = this._settings.connect(`changed::${key}`, () => {
            const value = this._settings.get_int(key);
            output.set_label(`${value} ${unit}`.trim());
            if (Math.round(adjustment.get_value()) !== value) {
                syncing = true;
                adjustment.set_value(value);
                syncing = false;
            }
            this._refreshLivePreview(prefix);
        });
        row.connect('destroy', () => {
            if (changedId)
                this._settings?.disconnect(changedId);
        });
        box.append(scale);
        box.append(output);
        row.add_suffix(box);
        row.activatable_widget = scale;
        return row;
    }

    _colorRow(prefix, suffix, title, statusRow) {
        const key = `${prefix}-${suffix}`;
        const row = new Adw.ActionRow({title});
        const rgba = new Gdk.RGBA();
        rgba.parse(this._settings.get_string(key));
        const button = new Gtk.ColorButton({
            rgba,
            use_alpha: false,
            valign: Gtk.Align.CENTER,
        });
        button.connect('color-set', widget => {
            const color = widget.rgba;
            const hex = `#${this._channel(color.red)}${this._channel(color.green)}${this._channel(color.blue)}`;
            this._settings.set_string(key, hex);
            this._refreshLivePreview(prefix);
            this._markPending(statusRow);
        });
        const changedId = this._settings.connect(`changed::${key}`, () => {
            const updated = new Gdk.RGBA();
            updated.parse(this._settings.get_string(key));
            button.set_rgba(updated);
            this._refreshLivePreview(prefix);
        });
        row.connect('destroy', () => {
            if (changedId)
                this._settings?.disconnect(changedId);
        });
        row.add_suffix(button);
        row.activatable_widget = button;
        return row;
    }

    _channel(value) {
        return Math.round(value * 255).toString(16).padStart(2, '0');
    }

    _buttonRow(title, iconName, callback, destructive = false) {
        const row = new Adw.ActionRow({title});
        row.add_prefix(new Gtk.Image({icon_name: iconName}));
        const button = new Gtk.Button({
            label: title,
            valign: Gtk.Align.CENTER,
        });
        if (destructive)
            button.add_css_class('destructive-action');
        button.connect('clicked', callback);
        row.add_suffix(button);
        row.activatable_widget = button;
        return row;
    }

    _infoRow(title, value) {
        const row = new Adw.ActionRow({title});
        row.add_suffix(new Gtk.Label({label: value, valign: Gtk.Align.CENTER}));
        return row;
    }

    _updateParameterVisibility(prefix, effect) {
        const state = this[`_${prefix}Appearance`];
        if (!state)
            return;
        const visible = {
            radius: effect === 'blur' || effect === 'glass',
            opacity: effect !== 'original',
            brightness: effect === 'blur',
            tint: effect === 'glass',
            color: effect === 'solid',
            'gradient-start': effect === 'gradient',
            'gradient-end': effect === 'gradient',
            direction: effect === 'gradient',
        };
        for (const [name, row] of state.rows)
            row.visible = visible[name];
        state.warningRow.visible = effect === 'blur' || effect === 'glass';
        const titles = {
            original: '背景效果', transparent: '透明参数', blur: '模糊参数',
            glass: '磨砂玻璃参数', solid: '纯色参数', gradient: '渐变参数',
        };
        state.parameterGroup.title = this._(titles[effect]);
    }

    _updateLinkedState() {
        const linked = this._settings.get_boolean('linked-targets');
        for (const control of this._appControls)
            control.sensitive = !linked;
        const status = linked ? this._('已联动') : this._('独立设置');
        if (this._appLinkStatus)
            this._appLinkStatus.label = status;
        if (this._dockLinkStatus)
            this._dockLinkStatus.label = status;
    }

    _copyDockToApplication() {
        for (const suffix of TARGET_SUFFIXES) {
            const source = this._settings.get_value(`dock-${suffix}`);
            this._settings.set_value(`app-${suffix}`, source);
        }
    }

    _markPending(statusRow) {
        if (!statusRow)
            return;
        const existing = this._statusSources.get(statusRow);
        if (existing)
            GLib.Source.remove(existing);
        statusRow.subtitle = this._('等待停止调整…');
        const delay = this._settings.get_int('apply-delay');
        const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            statusRow.subtitle = this._('设置已保存');
            this._statusSources.delete(statusRow);
            return GLib.SOURCE_REMOVE;
        });
        this._statusSources.set(statusRow, sourceId);
    }

    _exportPreset() {
        const dialog = new Gtk.FileDialog({
            title: this._('导出预设'),
            initial_name: 'gnome-beautify-preset.json',
        });
        dialog.save(this._window, null, (source, result) => {
            try {
                const file = source.save_finish(result);
                const values = {};
                for (const key of ALL_KEYS)
                    values[key] = this._settings.get_value(key).deepUnpack();
                const data = new TextEncoder().encode(JSON.stringify({
                    format: 'gnome-beautify-preset',
                    version: 1,
                    values,
                }, null, 2));
                file.replace_contents(data, null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                this._toast(this._('预设已导出'));
            } catch (error) {
                if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.error(error);
            }
        });
    }

    _importPreset() {
        const dialog = new Gtk.FileDialog({title: this._('导入预设')});
        const filter = new Gtk.FileFilter();
        filter.name = 'JSON';
        filter.add_mime_type('application/json');
        const filters = Gio.ListStore.new(Gtk.FileFilter);
        filters.append(filter);
        dialog.filters = filters;
        dialog.open(this._window, null, (source, result) => {
            try {
                const file = source.open_finish(result);
                const [, contents] = file.load_contents(null);
                const preset = JSON.parse(new TextDecoder().decode(contents));
                if (preset.format !== 'gnome-beautify-preset' || !preset.values)
                    throw new Error('Invalid preset');
                for (const key of ALL_KEYS) {
                    if (!(key in preset.values))
                        continue;
                    const type = this._settings.get_value(key).get_type_string();
                    if (type === 'b')
                        this._settings.set_boolean(key, Boolean(preset.values[key]));
                    else if (type === 'i')
                        this._settings.set_int(key, Number(preset.values[key]));
                    else if (type === 's')
                        this._settings.set_string(key, String(preset.values[key]));
                }
                this._toast(this._('预设已导入'));
            } catch (error) {
                if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                    console.error(error);
                    this._toast(this._('无法读取该预设文件'));
                }
            }
        });
    }

    _toast(title) {
        this._toastOverlay?.add_toast(new Adw.Toast({title}));
    }
}
