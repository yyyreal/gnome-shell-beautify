import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

function assertClose(actual, expected) {
    assert.equal(actual.length, expected.length);
    actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 0.0001,
        `${value} should be close to ${expected[index]}`));
}

// These are actor-tree/geometry regression tests, not a GPU or GNOME visual test.
class Actor {
    constructor(props = {}) {
        Object.assign(this, {
            x: 0, y: 0, width: 0, height: 0, opacity: 255, visible: true,
            scale_x: 1, scale_y: 1, translation_x: 0, translation_y: 0,
            allocated: true, clip_to_allocation: false, name: '', style: null,
        }, props);
        this.children = [];
        this.parent = null;
        this.signals = new Map();
        this.effects = new Map();
        this.nextId = 1;
    }
    get_name() { return this.name; }
    get_parent() { return this.parent; }
    get_children() { return [...this.children]; }
    add_child(child) { this.insert_child_below(child, null); }
    insert_child_below(child, sibling) {
        assert.equal(child.parent, null);
        const index = sibling ? this.children.indexOf(sibling) : 0;
        assert.ok(index >= 0);
        this.children.splice(index, 0, child);
        child.parent = this;
    }
    remove_child(child) {
        this.children.splice(this.children.indexOf(child), 1);
        child.parent = null;
    }
    connect(signal, callback) {
        const id = this.nextId++;
        this.signals.set(id, {signal, callback});
        return id;
    }
    disconnect(id) { assert.ok(this.signals.delete(id)); }
    emit(signal, ...args) {
        for (const [id, handler] of [...this.signals]) {
            if (this.signals.has(id) && handler.signal === signal)
                handler.callback(this, ...args);
        }
    }
    is_mapped() { return this.visible && (!this.parent || this.parent.is_mapped()); }
    has_allocation() { return this.allocated; }
    get_position() { return [this.x, this.y]; }
    stageScale() {
        const [sx, sy] = this.parent?.stageScale() ?? [1, 1];
        return [sx * this.scale_x, sy * this.scale_y];
    }
    get_transformed_position() {
        const [px, py] = this.parent?.get_transformed_position() ?? [0, 0];
        const [sx, sy] = this.parent?.stageScale() ?? [1, 1];
        return [px + (this.x + this.translation_x) * sx,
            py + (this.y + this.translation_y) * sy];
    }
    get_transformed_size() {
        const [sx, sy] = this.stageScale();
        return [this.width * sx, this.height * sy];
    }
    transform_stage_point(x, y) {
        const [px, py] = this.get_transformed_position();
        const [sx, sy] = this.stageScale();
        return [true, (x - px) / sx, (y - py) / sy];
    }
    set_position(x, y) { this.x = x; this.y = y; }
    set_size(width, height) { this.width = width; this.height = height; }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    get_style() { return this.style; }
    set_style(style) {
        if (this.style === style)
            return;
        this.style = style;
        this.emit('notify::style');
    }
    has_style_class_name(name) { return this.style_class === name; }
    get_effect(name) { return this.effects.get(name); }
    add_effect_with_name(name, effect) { this.effects.set(name, effect); }
    remove_effect(effect) {
        for (const [name, item] of this.effects) {
            if (item === effect)
                this.effects.delete(name);
        }
    }
    destroy() {
        if (this.destroyed)
            throw new Error('Actor destroyed twice');
        this.destroyed = true;
        this.emit('destroy');
        for (const child of [...this.children])
            child.destroy();
        this.parent?.remove_child(this);
        this.signals.clear();
        this.effects.clear();
    }
}

class Settings extends Actor {
    constructor(values) { super(); this.values = values; }
    get_boolean(key) { return this.values[key] ?? false; }
    get_int(key) { return this.values[key] ?? 0; }
    get_string(key) { return this.values[key] ?? ''; }
    set_boolean(key, value) { this.set(key, value); }
    set_int(key, value) { this.set(key, value); }
    set_string(key, value) { this.set(key, value); }
    set(key, value) {
        if (this.values[key] === value)
            return;
        this.values[key] = value;
        this.emit('changed', key);
        this.emit(`changed::${key}`, key);
    }
}

class Widget extends Actor {
    append(child) { this.add_child(child); }
    add(child) { this.add_child(child); }
    add_suffix(child) { this.add_child(child); }
    add_prefix(child) { this.add_child(child); }
    set_child(child) { this.add_child(child); }
    add_css_class() {}
    remove_css_class() {}
    set_group() {}
    set_label(label) { this.label = label; }
    get_value() { return this.value; }
    set_value(value) { this.value = value; this.emit('value-changed'); }
    set_active(value) { this.active = value; this.emit('toggled'); }
    set_rgba(value) { this.rgba = value; }
}

class Laters {
    callbacks = new Map();
    nextId = 1;
    add(type, callback) {
        assert.equal(type, 'BEFORE_REDRAW');
        const id = this.nextId++;
        this.callbacks.set(id, callback);
        return id;
    }
    remove(id) { this.callbacks.delete(id); }
    flush() {
        const callbacks = [...this.callbacks.values()];
        this.callbacks.clear();
        callbacks.forEach(callback => callback());
    }
}

async function fixture() {
    const stage = new Actor({width: 1920, height: 1080});
    const uiGroup = new Actor({width: 1920, height: 1080});
    stage.add_child(uiGroup);
    const panelBox = new Actor({name: 'panelBox', width: 1920, height: 32});
    const panel = new Actor({name: 'panel', width: 1920, height: 32});
    uiGroup.add_child(panelBox);
    panelBox.add_child(panel);
    const overviewGroup = new Actor({name: 'overviewGroup', width: 1920, height: 1080});
    const overviewActor = new Actor({name: 'overview', width: 1920, height: 1080});
    const controls = new Actor({name: 'controls-manager', width: 1920, height: 1080});
    const dash = new Actor({name: 'dash', y: 960, width: 1920, height: 120,
        offscreen_redirect: 'ALWAYS'});
    const background = new Actor({x: 600, y: 12, width: 720, height: 76});
    uiGroup.add_child(overviewGroup);
    overviewGroup.add_child(overviewActor);
    overviewActor.add_child(controls);
    controls.add_child(dash);
    dash.add_child(background);
    dash._background = background;
    dash._dashContainer = new Actor();
    const laters = new Laters();
    const timers = new Map();
    let timerId = 0;
    const GLib = {
        PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false,
        Source: {remove: id => timers.delete(id)},
        timeout_add: (_priority, delay, callback) => {
            const id = ++timerId;
            timers.set(id, {delay, callback: () => {
                timers.delete(id);
                return callback();
            }});
            return id;
        },
    };
    const Main = {panel, uiGroup, layoutManager: {panelBox, overviewGroup}, overview: new Actor({dash})};
    const context = vm.createContext({console, global: {stage, compositor: {get_laters: () => laters}}});
    const Clutter = {FixedLayout: class FixedLayout {}, ActorAlign: {START: 'START'}};
    const Meta = {BackgroundGroup: Actor, LaterType: {BEFORE_REDRAW: 'BEFORE_REDRAW'}};
    const St = {Widget: Actor};
    const Gtk = Object.fromEntries(['Box', 'Label', 'Image', 'Button', 'ToggleButton', 'FlowBox',
        'Scale', 'Adjustment', 'ColorButton'].map(name => [name, Widget]));
    Object.assign(Gtk, {Orientation: {HORIZONTAL: 0, VERTICAL: 1}, Align: {CENTER: 0, START: 1},
        SelectionMode: {NONE: 0}});
    const Adw = Object.fromEntries(['ActionRow', 'PreferencesPage', 'PreferencesGroup']
        .map(name => [name, Widget]));
    const Gdk = {RGBA: class { parse(value) { this.value = value; } }};
    const Shell = {BlurMode: {BACKGROUND: 'BACKGROUND'}, BlurEffect: class {
        constructor(props) { Object.assign(this, props); this.repaints = 0; }
        queue_repaint() { this.repaints++; }
    }};
    function synthetic(exports) {
        return new vm.SyntheticModule(Object.keys(exports), function () {
            for (const [key, value] of Object.entries(exports))
                this.setExport(key, value);
        }, {context});
    }
    const mocks = new Map([
        ['gi://Clutter', synthetic({default: Clutter})],
        ['gi://Meta', synthetic({default: Meta})],
        ['gi://Shell', synthetic({default: Shell})],
        ['gi://St', synthetic({default: St})],
        ['gi://Gio', synthetic({default: {}})],
        ['gi://GLib', synthetic({default: GLib})],
        ['gi://Gtk?version=4.0', synthetic({default: Gtk})],
        ['gi://Gdk?version=4.0', synthetic({default: Gdk})],
        ['gi://Adw', synthetic({default: Adw})],
        ['resource:///org/gnome/shell/extensions/extension.js', synthetic({Extension: class {}})],
        ['resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js', synthetic({ExtensionPreferences: class {}})],
        ['resource:///org/gnome/shell/ui/main.js', synthetic(Main)],
        ['./i18n.js', synthetic({getTranslator: () => text => text})],
    ]);
    const layerModule = new vm.SourceTextModule(
        await readFile(new URL('../blurSurface.js', import.meta.url), 'utf8'), {context});
    mocks.set('./blurSurface.js', layerModule);
    const configModule = new vm.SourceTextModule(
        await readFile(new URL('../appearanceConfig.js', import.meta.url), 'utf8'), {context});
    mocks.set('./appearanceConfig.js', configModule);
    const extensionModule = new vm.SourceTextModule(
        await readFile(new URL('../extension.js', import.meta.url), 'utf8'), {context});
    const linker = specifier => {
        if (!mocks.has(specifier))
            mocks.set(specifier, synthetic({}));
        return mocks.get(specifier);
    };
    await extensionModule.link(linker);
    await extensionModule.evaluate();
    const extension = new extensionModule.namespace.default();
    extension.uuid = 'gnome-beautify@yyyreal.github.com';
    const values = {
        'linked-targets': false, 'battery-reduce': false, 'apply-delay': 2000,
        'runtime-status': '', 'status-request': '',
    };
    for (const prefix of ['dock', 'app']) {
        Object.assign(values, {
            [`${prefix}-effect`]: 'blur', [`${prefix}-opacity`]: 62,
            [`${prefix}-blur-radius`]: 34, [`${prefix}-brightness`]: 92,
            [`${prefix}-corner-radius`]: 18, [`${prefix}-border-width`]: 1,
            [`${prefix}-shadow-strength`]: 20, [`${prefix}-tint`]: 18,
            [`${prefix}-color`]: '#544d42', [`${prefix}-gradient-start`]: '#5a416d',
            [`${prefix}-gradient-end`]: '#8c425f', [`${prefix}-gradient-direction`]: 100,
        });
    }
    const settings = new Settings(values);
    extension._settings = settings;
    extension._settingsChangedId = settings.connect('changed', (_s, key) => extension._onSettingChanged(key));
    extension._originalActors = new Map();
    extension._blurSurfaces = new Map();
    extension._targetStates = new Map();
    extension._missingTargets = new Set();
    extension._enabled = true;
    extension._revision = 0;
    extension._applySource = 0;
    extension._retryAttempt = 0;
    extension._retrySource = 0;
    extension._refreshSource = 0;
    extension._frameRefreshId = 0;
    extension._connectOverviewSignals();
    extension._isDarkTheme = () => true;
    extension._scheduleIndicatorSync = () => {};
    const prefsModule = new vm.SourceTextModule(
        await readFile(new URL('../prefs.js', import.meta.url), 'utf8'), {context});
    await prefsModule.link(linker);
    await prefsModule.evaluate();
    const prefs = new prefsModule.namespace.default();
    Object.assign(prefs, {_settings: settings, _: text => text, _statusRows: [],
        _statusRequest: 'test-ui', _appControls: [], _toast: () => {}});
    const runtime = () => JSON.parse(values['runtime-status']);
    return {extension, values, settings, prefs, runtime, Main, stage, panel, panelBox, uiGroup, overviewGroup,
        overviewActor, controls, dash, background, laters, timers, ...layerModule.namespace,
        ...configModule.namespace};
}

test('顶部模糊层不能加入 panelBox，也不能使栏位高度翻倍', async () => {
    const f = await fixture();
    f.extension._commitSettings();
    f.laters.flush();
    assert.deepEqual(f.panelBox.children, [f.panel]);
    assert.equal(f.panelBox.height, 32);
    const layer = f.extension._blurSurfaces.get(f.panel);
    assert.equal(layer.parent, f.uiGroup);
    assert.equal(layer.group.width, 0);
    assert.equal(layer.group.height, 0);
    assert.equal(layer.group.x_align, 'START');
    assert.equal(layer.group.y_align, 'START');
    assert.deepEqual(layer.surface.get_position(), [0, 0]);
    assert.deepEqual([layer.surface.width, layer.surface.height], [1920, 32]);
    assert.ok(f.uiGroup.children.indexOf(layer.group) < f.uiGroup.children.indexOf(f.panelBox));
});

test('原生 Dash 模糊层位于离屏树和忽略额外子项的 ControlsManager 布局之外', async () => {
    const f = await fixture();
    f.extension._commitSettings();
    f.laters.flush();
    const layer = f.extension._blurSurfaces.get(f.background);
    assert.equal(layer.parent, f.overviewGroup);
    assert.equal(layer.anchor, f.overviewActor);
    assert.deepEqual(f.controls.children, [f.dash]);
    assert.deepEqual(f.dash.children, [f.background]);
    for (let ancestor = layer.surface; ancestor; ancestor = ancestor.parent)
        assert.notEqual(ancestor.offscreen_redirect, 'ALWAYS');
    assert.deepEqual(layer.surface.get_position(), [600, 972]);
    assert.deepEqual([layer.surface.width, layer.surface.height], [720, 76]);
});

test('Ubuntu 垂直 Dock：采样层在 dash 外、保留滑动容器裁剪、不占额外宽高', async () => {
    const f = await fixture();
    const dock = new Actor({name: 'dashtodockContainer', y: 32, width: 64, height: 1048});
    const slider = new Actor({width: 64, height: 1048, clip_to_allocation: true});
    const box = new Actor({width: 64, height: 1048});
    const dash = new Actor({name: 'dash', width: 64, height: 1048, offscreen_redirect: 'ALWAYS'});
    const background = new Actor({x: 2, y: 4, width: 60, height: 1040});
    dash._background = background;
    dash._dashContainer = new Actor();
    dock.dash = dash;
    f.uiGroup.add_child(dock);
    dock.add_child(slider);
    slider.add_child(box);
    box.add_child(dash);
    dash.add_child(background);
    // Some Ubuntu Dock releases replace Main.overview.dash. Do not attach twice.
    f.Main.overview.dash = dash;
    f.extension._commitSettings();
    f.laters.flush();
    assert.equal(f.extension._blurSurfaces.size, 2);
    const layer = f.extension._blurSurfaces.get(background);
    assert.equal(layer.parent, box);
    assert.equal(layer.anchor, dash);
    assert.equal(layer.group.width, 0);
    assert.equal(layer.group.height, 0);
    assert.equal(box.children.reduce((sum, child) => sum + child.width, 0), 64);
    assert.equal(box.children.reduce((sum, child) => sum + child.height, 0), 1048);
    assert.deepEqual(layer.surface.get_transformed_position(), background.get_transformed_position());
    assert.deepEqual(layer.surface.get_transformed_size(), background.get_transformed_size());
    assert.equal(layer.group.parent.parent, slider);
});

test('位置和大小换算支持副屏偏移、缩放和背景内边距', async () => {
    const f = await fixture();
    f.overviewGroup.x = 1920;
    f.overviewGroup.scale_x = 1.5;
    f.overviewGroup.scale_y = 1.5;
    f.dash.scale_x = 0.8;
    f.dash.translation_y = -40;
    f.extension._commitSettings();
    f.laters.flush();
    const layer = f.extension._blurSurfaces.get(f.background);
    assert.deepEqual(layer.surface.get_transformed_position(), f.background.get_transformed_position());
    assertClose(layer.surface.get_transformed_size(), f.background.get_transformed_size());
    f.background.width = 800;
    f.background.emit('notify::allocation');
    f.background.emit('notify::allocation');
    assert.equal(f.laters.callbacks.size, 1);
    f.laters.flush();
    assertClose(layer.surface.get_transformed_size(), f.background.get_transformed_size());
});

test('连续调整半径只保留一个延迟任务，停止调整后才更新效果', async () => {
    const f = await fixture();
    f.extension._commitSettings();
    f.laters.flush();
    const layer = f.extension._blurSurfaces.get(f.background);
    const blur = layer.surface.get_effect(f.BLUR_EFFECT_NAME);
    for (const radius of [10, 20, 40, 80]) {
        f.values['app-blur-radius'] = radius;
        f.extension._scheduleApply();
    }
    assert.equal(blur.radius, 34);
    assert.equal(f.timers.size, 1);
    const timer = [...f.timers.values()][0];
    assert.equal(timer.delay, 2000);
    timer.callback();
    assert.equal(blur.radius, 80);
    assert.equal(f.extension._applySource, 0);
});

test('模糊/磨砂半径均传到同一背景效果，联动与独立配置保留', async () => {
    const f = await fixture();
    f.values['dock-blur-radius'] = 12;
    f.values['app-blur-radius'] = 64;
    f.values['app-effect'] = 'glass';
    f.extension._commitSettings();
    const panelLayer = f.extension._blurSurfaces.get(f.panel);
    const dashLayer = f.extension._blurSurfaces.get(f.background);
    const panelBlur = panelLayer.surface.get_effect(f.BLUR_EFFECT_NAME);
    const dashBlur = dashLayer.surface.get_effect(f.BLUR_EFFECT_NAME);
    assert.equal(panelBlur.radius, 12);
    assert.equal(dashBlur.radius, 64);
    assert.equal(dashBlur.brightness, 1);
    assert.equal(dashBlur.mode, 'BACKGROUND');
    assert.equal(f.background.get_effect(f.BLUR_EFFECT_NAME), undefined);
    f.values['app-blur-radius'] = 0;
    f.extension._commitSettings();
    assert.equal(dashBlur.radius, 0);
    assert.equal(f.extension._blurSurfaces.get(f.background), dashLayer);
    assert.ok(dashBlur.repaints >= 2);
    f.values['linked-targets'] = true;
    f.extension._commitSettings();
    assert.equal(dashBlur.radius, 12);
    assert.equal(dashBlur.brightness, 0.92);
});

test('隐藏/未分配/渐隐的目标不能留下漂浮的模糊条', async () => {
    const f = await fixture();
    f.extension._commitSettings();
    f.laters.flush();
    const layer = f.extension._blurSurfaces.get(f.background);
    f.dash.hide();
    f.dash.emit('notify::mapped');
    f.laters.flush();
    assert.equal(layer.surface.visible, false);
    f.dash.show();
    f.dash.opacity = 128;
    f.dash.emit('notify::opacity');
    f.laters.flush();
    assert.equal(layer.surface.visible, true);
    assert.equal(layer.surface.opacity, 128);
    f.background.allocated = false;
    f.background.emit('notify::allocation');
    f.laters.flush();
    assert.equal(layer.surface.visible, false);
});

test('切换原始/透明/100%透明后移除模糊；禁用恢复原样并取消回调', async () => {
    const f = await fixture();
    for (const [effect, transparency] of [['original', 62], ['transparent', 62], ['blur', 100]]) {
        f.values['dock-effect'] = 'blur';
        f.values['dock-opacity'] = 62;
        f.extension._commitSettings();
        const old = f.extension._blurSurfaces.get(f.panel);
        f.values['dock-effect'] = effect;
        f.values['dock-opacity'] = transparency;
        f.extension._commitSettings();
        assert.ok(old.destroyed);
        assert.equal(f.extension._blurSurfaces.has(f.panel), false);
    }
    f.extension._restoreActors();
    assert.equal(f.extension._blurSurfaces.size, 0);
    assert.equal(f.laters.callbacks.size, 0);
    assert.equal(f.panel.style, null);
    assert.equal(f.background.style, null);
    assert.deepEqual(f.panelBox.children, [f.panel]);
    assert.deepEqual(f.overviewGroup.children, [f.overviewActor]);
});

test('外部销毁背景组或 Dock 时安全清理一次，不使用已销毁 Actor', async () => {
    const f = await fixture();
    f.extension._commitSettings();
    const layer = f.extension._blurSurfaces.get(f.background);
    layer.group.destroy();
    assert.ok(layer.destroyed);
    assert.equal(f.extension._blurSurfaces.has(f.background), false);
    f.extension._commitSettings();
    const recreated = f.extension._blurSurfaces.get(f.background);
    f.dash.destroy();
    assert.ok(recreated.destroyed);
    assert.equal(f.extension._blurSurfaces.has(f.background), false);
    assert.equal(f.overviewGroup.signals.size, 0);
    f.laters.flush();
    f.extension._restoreActors();
    assert.equal(f.laters.callbacks.size, 0);
});

test('目标重新挂载时丢弃旧背景组，不能留在旧位置', async () => {
    const f = await fixture();
    f.extension._commitSettings();
    const layer = f.extension._blurSurfaces.get(f.background);
    f.overviewGroup.remove_child(f.overviewActor);
    f.uiGroup.add_child(f.overviewActor);
    f.laters.flush();
    assert.ok(layer.destroyed);
    f.extension._commitSettings();
    const replacement = f.extension._blurSurfaces.get(f.background);
    assert.notEqual(replacement, layer);
    assert.equal(replacement.parent, f.uiGroup);
});

function fireTimer(f, id) {
    const timer = f.timers.get(id);
    assert.ok(timer, `Missing timer ${id}`);
    timer.callback();
}

function findWidget(root, predicate) {
    if (predicate(root))
        return root;
    for (const child of root.children) {
        const result = findWidget(child, predicate);
        if (result)
            return result;
    }
    return null;
}

test('联动：6效果×3透明度×2性能状态始终使用同一个不可变配置', async () => {
    for (const effect of ['original', 'transparent', 'blur', 'glass', 'solid', 'gradient']) {
        for (const opacity of [0, 62, 100]) {
            for (const protection of [false, true]) {
                const f = await fixture();
                Object.assign(f.values, {'linked-targets': true, 'dock-effect': effect,
                    'app-effect': 'original', 'dock-opacity': opacity, 'app-opacity': 17,
                    'dock-blur-radius': 61, 'app-blur-radius': 3,
                    'performance-protection': protection, 'battery-reduce': protection});
                f.extension._overviewAnimating = protection;
                f.extension._onBattery = protection;
                f.extension._commitSettings();
                f.laters.flush();
                const snapshot = f.extension._committedSnapshot;
                assert.equal(snapshot.dock, snapshot.app);
                assert.ok(Object.isFrozen(snapshot.dock));
                assert.equal(f.panel.style, f.background.style);
                const signature = actor => {
                    const blur = f.extension._blurSurfaces.get(actor)?.surface.get_effect(f.BLUR_EFFECT_NAME);
                    return blur ? [blur.mode, blur.radius, blur.brightness] : null;
                };
                assert.deepEqual(signature(f.panel), signature(f.background));
                assert.deepEqual(f.runtime().targets, {dock: 'applied', app: 'applied'});
                f.extension._restoreActors();
            }
        }
    }
});

test('联动页面同步效果选项、全部滑块、颜色、预览；解除后恢复独立配置', async () => {
    const f = await fixture();
    f.values['app-blur-radius'] = 9;
    f.values['app-effect'] = 'solid';
    f.values['app-color'] = '#abcdef';
    f.prefs._buildAppearancePage('app');
    f.extension._commitSettings();
    f.laters.flush();
    f.settings.set_boolean('linked-targets', true);
    assert.equal(f.timers.get(f.extension._applySource).delay, 0);
    f.settings.set_string('dock-effect', 'glass');
    fireTimer(f, f.extension._applySource);
    f.settings.set_int('dock-blur-radius', 61);
    const state = f.prefs._appAppearance;
    assert.equal(state.effectButtons.get('glass').active, true);
    assert.equal(state.parameterGroup.title, '磨砂玻璃参数');
    assert.match(state.livePreview.value.label, /61 px/);
    const scale = findWidget(state.rows.get('radius'), widget => Boolean(widget.adjustment));
    assert.equal(scale.adjustment.get_value(), 61);
    assert.ok(findWidget(state.rows.get('radius'), widget => widget.label === '61 px'));
    for (const [suffix, rowName, value] of [
        ['opacity', 'opacity', 71], ['brightness', 'brightness', 111],
        ['tint', 'tint', 45], ['gradient-direction', 'direction', 250],
    ]) {
        f.settings.set_int(`dock-${suffix}`, value);
        assert.equal(findWidget(state.rows.get(rowName), w => Boolean(w.adjustment)).adjustment.value, value);
    }
    for (const [suffix, title, value] of [
        ['corner-radius', '圆角', 23], ['border-width', '边框', 3],
        ['shadow-strength', '阴影', 65],
    ]) {
        f.settings.set_int(`dock-${suffix}`, value);
        const row = findWidget(state.page, w => w.title === title);
        assert.equal(findWidget(row, w => Boolean(w.adjustment)).adjustment.value, value);
    }
    f.settings.set_string('dock-color', '#123456');
    assert.equal(findWidget(state.rows.get('color'), w => Boolean(w.rgba)).rgba.value, '#123456');
    for (const suffix of ['gradient-start', 'gradient-end']) {
        f.settings.set_string(`dock-${suffix}`, '#654321');
        assert.equal(findWidget(state.rows.get(suffix), w => Boolean(w.rgba)).rgba.value, '#654321');
    }
    assert.equal(f.values['app-blur-radius'], 9);
    assert.equal(f.values['app-color'], '#abcdef');
    f.settings.set_boolean('linked-targets', false);
    assert.equal(scale.adjustment.value, 9);
    assert.equal(state.effectButtons.get('solid').active, true);
    assert.equal(findWidget(state.rows.get('color'), w => Boolean(w.rgba)).rgba.value, '#abcdef');
    assert.equal(f.timers.get(f.extension._applySource).delay, 0);
    fireTimer(f, f.extension._applySource);
    assert.equal(f.extension._committedSnapshot.app.effect, 'solid');
    assert.equal(f.extension._committedSnapshot.dock.effect, 'glass');
});

test('主题、概览、重建同步均不能抢先提交拖动中的参数或产生第二次提交', async () => {
    const f = await fixture();
    f.values['linked-targets'] = true;
    f.values['performance-protection'] = true;
    f.extension._commitSettings();
    f.laters.flush();
    const revision = f.extension._revision;
    f.settings.set_int('dock-blur-radius', 80);
    const applyId = f.extension._applySource;
    f.extension._queueRefresh();
    fireTimer(f, f.extension._refreshSource);
    assert.equal(f.extension._committedSnapshot.dock['blur-radius'], 34);
    assert.equal(f.extension._applySource, applyId);
    f.extension._beginOverviewAnimation();
    f.laters.flush();
    const blur = f.extension._blurSurfaces.get(f.panel).surface.get_effect(f.BLUR_EFFECT_NAME);
    assert.equal(blur.radius, Math.round(34 * 0.55));
    f.Main.overview.emit('shown');
    f.laters.flush();
    f.extension._scheduleIndicatorSync = Object.getPrototypeOf(f.extension)._scheduleIndicatorSync;
    f.extension._syncIndicator = () => {};
    f.extension._scheduleIndicatorSync();
    fireTimer(f, f.extension._indicatorSyncSource);
    fireTimer(f, f.extension._refreshSource);
    assert.equal(f.extension._revision, revision);
    assert.equal(blur.radius, 34);
    assert.equal(f.extension._applySource, applyId);
    fireTimer(f, applyId);
    f.laters.flush();
    assert.equal(blur.radius, 80);
    assert.equal(f.extension._revision, revision + 1);
    assert.equal(f.runtime().pending, false);
});

test('语言、图标、状态响应和被联动覆盖的app参数不会重置防抖', async () => {
    const f = await fixture();
    f.values['linked-targets'] = true;
    f.extension._commitSettings();
    f.laters.flush();
    f.settings.set_int('dock-blur-radius', 60);
    const id = f.extension._applySource;
    f.extension._syncIndicator = () => {};
    f.settings.set_string('language-mode', 'zh');
    f.settings.set_boolean('show-indicator', true);
    f.settings.set_string('status-request', 'test-ui');
    f.settings.set_int('app-blur-radius', 5);
    assert.equal(f.extension._applySource, id);
    assert.equal(f.timers.size, 1);
    assert.equal(f.runtime().request, 'test-ui');
});

test('Dash挂载失败报告单端失败，恢复后重试成功且不提交新参数', async () => {
    const f = await fixture();
    f.values['linked-targets'] = true;
    const insert = f.overviewGroup.insert_child_below.bind(f.overviewGroup);
    f.overviewGroup.insert_child_below = () => { throw new Error('Simulated unready Dash'); };
    f.extension._commitSettings();
    f.laters.flush();
    assert.deepEqual(f.runtime().targets, {dock: 'applied', app: 'failed'});
    assert.equal(f.runtime().retrying, true);
    f.settings.set_int('dock-blur-radius', 80);
    f.overviewGroup.insert_child_below = insert;
    fireTimer(f, f.extension._retrySource);
    f.laters.flush();
    assert.deepEqual(f.runtime().targets, {dock: 'applied', app: 'applied'});
    assert.equal(f.runtime().pending, true);
    assert.equal(f.extension._blurSurfaces.get(f.background).surface.get_effect(f.BLUR_EFFECT_NAME).radius, 34);
    assert.equal(f.extension._retrySource, 0);
});

test('持续失败最多重试三次，不能把失败显示成已应用', async () => {
    const f = await fixture();
    f.overviewGroup.insert_child_below = () => { throw new Error('Simulated persistent failure'); };
    f.extension._commitSettings();
    f.laters.flush();
    const delays = [];
    while (f.extension._retrySource) {
        assert.ok(delays.length < 4, 'Retry loop must be bounded');
        delays.push(f.timers.get(f.extension._retrySource).delay);
        fireTimer(f, f.extension._retrySource);
        f.laters.flush();
    }
    assert.deepEqual(delays, [300, 800, 1600]);
    f.settings.set_string('status-request', 'test-ui');
    assert.equal(f.runtime().targets.app, 'failed');
    assert.equal(f.runtime().retrying, false);
    assert.match(f.runtimeSummary(f.settings, 'test-ui', s => s), /应用失败/);
});

test('系统重写Dash样式后恢复已提交配置，不偷读待应用参数；禁用还原系统新样式', async () => {
    const f = await fixture();
    f.values['linked-targets'] = true;
    f.extension._commitSettings();
    f.laters.flush();
    f.settings.set_int('dock-opacity', 80);
    const delayId = f.extension._applySource;
    const hostStyle = 'background-color: rgb(0,0,0);';
    f.background.set_style(hostStyle);
    assert.equal(f.runtime().targets.app, 'failed');
    f.laters.flush();
    f.laters.flush();
    assert.ok(f.background.style.includes('0.38'));
    assert.equal(f.extension._committedSnapshot.dock.opacity, 62);
    assert.equal(f.extension._applySource, delayId);
    assert.equal(f.runtime().targets.app, 'applied');
    f.extension._restoreActors();
    assert.equal(f.background.style, hostStyle);
});

test('单个Actor写入失败不会中断其他目标的应用', async () => {
    const f = await fixture();
    f.panel.set_style = () => { throw new Error('Simulated panel style failure'); };
    f.extension._commitSettings();
    f.laters.flush();
    assert.equal(f.runtime().targets.dock, 'failed');
    assert.equal(f.runtime().targets.app, 'applied');
    assert.ok(f.extension._retrySource);
});

test('状态需新会话请求确认，不接受旧成功记录，也不会计时后伪报成功', async () => {
    const f = await fixture();
    f.extension._commitSettings();
    f.laters.flush();
    assert.match(f.runtimeSummary(f.settings, 'test-ui', s => s), /等待扩展响应/);
    f.settings.set_string('status-request', 'test-ui');
    assert.match(f.runtimeSummary(f.settings, 'test-ui', s => s), /配置已应用/);
    f.settings.set_int('dock-opacity', 75);
    assert.match(f.runtimeSummary(f.settings, 'test-ui', s => s), /等待应用最新设置/);
    const before = f.timers.size;
    const row = {subtitle: ''};
    f.prefs._statusRows = [row];
    f.prefs._markPending(row);
    assert.equal(f.timers.size, before);
    assert.match(row.subtitle, /等待应用最新设置/);
    f.extension._enabled = false;
    f.extension._publishStatus();
    assert.match(f.runtimeSummary(f.settings, 'test-ui', s => s), /扩展未启用/);
});

test('隐藏的Dash报告等待显示，未分配的背景报告等待就绪', async () => {
    const f = await fixture();
    f.dash.hide();
    f.extension._commitSettings();
    f.laters.flush();
    assert.equal(f.runtime().targets.app, 'hidden');
    assert.equal(f.extension._retrySource, 0);
    f.dash.show();
    f.background.allocated = false;
    f.dash.emit('notify::mapped');
    f.laters.flush();
    assert.equal(f.runtime().targets.app, 'waiting');
    f.background.allocated = true;
    f.background.emit('notify::allocation');
    f.laters.flush();
    assert.equal(f.runtime().targets.app, 'applied');
});

test('透明和原始效果也准确报告显隐，原始模式跟踪系统最新样式', async () => {
    const f = await fixture();
    for (const effect of ['original', 'transparent', 'solid', 'gradient']) {
        f.values['app-effect'] = effect;
        f.extension._commitSettings();
        f.laters.flush();
        f.background.hide();
        f.background.emit('notify::mapped');
        assert.equal(f.runtime().targets.app, 'hidden');
        f.background.show();
        f.background.emit('notify::mapped');
        assert.equal(f.runtime().targets.app, 'applied');
    }
    f.values['app-effect'] = 'original';
    f.extension._commitSettings();
    f.background.set_style('background-color: white;');
    f.extension._queueRefresh();
    fireTimer(f, f.extension._refreshSource);
    assert.equal(f.background.style, 'background-color: white;');
    f.values['app-effect'] = 'blur';
    f.extension._commitSettings();
    f.extension._restoreActors();
    assert.equal(f.background.style, 'background-color: white;');
});

test('Dash尚未创建时报告缺失，出现后使用已提交联动配置重试', async () => {
    const f = await fixture();
    f.values['linked-targets'] = true;
    f.Main.overview.dash = null;
    f.extension._commitSettings();
    f.laters.flush();
    assert.equal(f.runtime().targets.app, 'missing');
    f.settings.set_int('dock-blur-radius', 80);
    const pending = f.extension._applySource;
    f.Main.overview.dash = f.dash;
    fireTimer(f, f.extension._retrySource);
    f.laters.flush();
    assert.equal(f.runtime().targets.app, 'applied');
    assert.equal(f.extension._blurSurfaces.get(f.background).surface.get_effect(f.BLUR_EFFECT_NAME).radius, 34);
    assert.equal(f.extension._applySource, pending);
});

test('多屏应用栏共用联动快照，任何一屏失败都不能报告全部成功', async () => {
    const f = await fixture();
    f.values['linked-targets'] = true;
    const backgrounds = [];
    for (const offset of [0, 1920]) {
        const dock = new Actor({name: 'dashtodockContainer', x: offset, width: 64, height: 1080});
        const box = new Actor({width: 64, height: 1080});
        const dash = new Actor({width: 64, height: 1080});
        const background = new Actor({width: 64, height: 1080});
        dock.dash = dash;
        dash._background = background;
        dash._dashContainer = new Actor();
        f.uiGroup.add_child(dock);
        dock.add_child(box);
        box.add_child(dash);
        dash.add_child(background);
        backgrounds.push(background);
    }
    f.extension._commitSettings();
    f.laters.flush();
    assert.equal(f.extension._blurSurfaces.size, 4);
    for (const background of backgrounds)
        assert.equal(background.style, f.panel.style);
    const writeStyle = backgrounds[1].set_style.bind(backgrounds[1]);
    backgrounds[1].set_style = () => { throw new Error('Simulated secondary display failure'); };
    f.settings.set_string('dock-effect', 'glass');
    fireTimer(f, f.extension._applySource);
    f.laters.flush();
    assert.deepEqual(f.runtime().targets, {dock: 'applied', app: 'failed'});
    backgrounds[1].set_style = writeStyle;
    fireTimer(f, f.extension._retrySource);
    f.laters.flush();
    assert.deepEqual(f.runtime().targets, {dock: 'applied', app: 'applied'});
});

test('实际disable取消待应用、刷新、重试和绘制前回调，销毁全部信号与背景层', async () => {
    const f = await fixture();
    f.values['performance-protection'] = true;
    f.extension._commitSettings();
    f.laters.flush();
    f.settings.set_int('dock-opacity', 78);
    f.extension._beginOverviewAnimation();
    f.background.allocated = false;
    f.background.emit('notify::allocation');
    f.laters.flush();
    f.extension._scheduleIndicatorSync = Object.getPrototypeOf(f.extension)._scheduleIndicatorSync;
    f.extension._scheduleIndicatorSync();
    assert.ok(f.extension._retrySource);
    assert.ok(f.timers.size >= 3);
    f.extension._queueFrameRefresh();
    assert.ok(f.extension._frameRefreshId);
    f.extension.disable();
    assert.equal(f.timers.size, 0);
    assert.equal(f.laters.callbacks.size, 0);
    assert.equal(f.settings.signals.size, 0);
    assert.equal(f.panel.signals.size, 0);
    assert.equal(f.background.signals.size, 0);
    assert.equal(f.dash.signals.size, 0);
    assert.equal(f.Main.overview.signals.size, 0);
    assert.equal(f.runtime().active, false);
    assert.equal(f.panel.style, null);
    assert.equal(f.background.style, null);
    assert.deepEqual(f.overviewGroup.children, [f.overviewActor]);
    f.settings.set_int('dock-opacity', 15);
    f.extension._queueRefresh();
    assert.equal(f.timers.size, 0);
});

test('模糊属性更新失败不能被随后的几何或显隐回调误报成功', async () => {
    const f = await fixture();
    f.extension._commitSettings();
    f.laters.flush();
    const layer = f.extension._blurSurfaces.get(f.background);
    const blur = layer.surface.get_effect(f.BLUR_EFFECT_NAME);
    Object.defineProperty(blur, 'radius', {
        configurable: true, get: () => 34,
        set: () => { throw new Error('Simulated blur property failure'); },
    });
    f.values['app-blur-radius'] = 65;
    f.extension._commitSettings();
    assert.equal(f.runtime().targets.app, 'failed');
    f.background.hide();
    f.background.emit('notify::mapped');
    f.laters.flush();
    assert.equal(f.runtime().targets.app, 'failed');
    f.background.show();
    f.background.emit('notify::mapped');
    f.laters.flush();
    assert.equal(f.runtime().targets.app, 'failed');
    assert.equal(f.extension._committedSnapshot.app['blur-radius'], 65);
    Object.defineProperty(blur, 'radius', {writable: true, configurable: true, value: 34});
    fireTimer(f, f.extension._retrySource);
    f.laters.flush();
    assert.equal(blur.radius, 65);
    assert.equal(f.runtime().targets.app, 'applied');
});

test('持续的主题样式争用会停止重试，保留最新系统样式供恢复', async () => {
    const f = await fixture();
    const setStyle = f.background.set_style.bind(f.background);
    const hostStyle = 'background-color: black;';
    f.background.set_style = style => {
        setStyle(style);
        setStyle(hostStyle);
    };
    f.extension._commitSettings();
    f.laters.flush();
    let retries = 0;
    while (f.extension._retrySource) {
        assert.ok(++retries <= 3);
        fireTimer(f, f.extension._retrySource);
        f.laters.flush();
    }
    assert.equal(retries, 3);
    assert.equal(f.runtime().targets.app, 'failed');
    assert.equal(f.extension._originalActors.get(f.background).style, hostStyle);
    assert.equal(f.extension._refreshSource, 0);
});

test('36种效果切换路径：联动同时提交并清除上一种效果的模糊层', async () => {
    const effects = ['original', 'transparent', 'blur', 'glass', 'solid', 'gradient'];
    for (const before of effects) {
        for (const after of effects) {
            const f = await fixture();
            f.values['linked-targets'] = true;
            f.values['dock-effect'] = before;
            f.extension._commitSettings();
            f.laters.flush();
            const revision = f.extension._revision;
            f.settings.set_string('dock-effect', after);
            if (after !== before)
                fireTimer(f, f.extension._applySource);
            f.laters.flush();
            assert.equal(f.extension._revision, revision + (after !== before ? 1 : 0));
            assert.equal(f.extension._blurSurfaces.size, ['blur', 'glass'].includes(after) ? 2 : 0);
            assert.equal(f.panel.style, f.background.style);
            assert.deepEqual(f.runtime().targets, {dock: 'applied', app: 'applied'});
            f.extension.disable();
            assert.equal(f.timers.size, 0);
        }
    }
});

test('GNOME退出概览清空panel.style后，下一次绘制前必须恢复而不是等待50ms', async () => {
    for (const protection of [false, true]) {
        const f = await fixture();
        f.values['performance-protection'] = protection;
        f.extension._commitSettings();
        f.laters.flush();
        const style = f.panel.style;
        const layer = f.extension._blurSurfaces.get(f.panel);
        f.extension._beginOverviewAnimation();
        // GNOME 50 Overview._hideDone() clears this after emitting 'hidden'.
        f.panel.set_style(null);
        f.laters.flush();
        assert.equal(f.panel.style, style, 'Default black panel must not reach the next paint');
        assert.equal(f.extension._blurSurfaces.get(f.panel), layer);
        assert.equal(layer.surface.visible, true);
        assert.equal(f.extension._refreshSource, 0);
        f.extension.disable();
    }
});

test('概览生命周期信号驱动性能保护：开关反复切换不抢先提交滑块，也不重建模糊层', async () => {
    for (const protection of [false, true]) {
        for (const effect of ['blur', 'glass']) {
            const f = await fixture();
            Object.assign(f.values, {'linked-targets': true, 'performance-protection': protection,
                'dock-effect': effect, 'dock-blur-radius': 60});
            f.extension._commitSettings();
            f.laters.flush();
            const revision = f.extension._revision;
            const layers = [f.panel, f.background].map(actor => f.extension._blurSurfaces.get(actor));
            const blurs = layers.map(layer => layer.surface.get_effect(f.BLUR_EFFECT_NAME));
            const style = f.panel.style;
            f.settings.set_int('dock-blur-radius', 80);
            const applyId = f.extension._applySource;
            for (let iteration = 0; iteration < 5; iteration++) {
                for (const [signal, animating] of [['showing', true], ['shown', false],
                    ['hiding', true], ['hidden', false]]) {
                    f.Main.overview.emit(signal);
                    if (signal === 'hidden')
                        f.panel.set_style(null); // Shell resets after the signal.
                    f.laters.flush();
                    f.laters.flush();
                    assert.equal(f.extension._overviewAnimating, animating);
                    const radius = protection && animating ? 33 : 60;
                    for (const blur of blurs)
                        assert.equal(blur.radius, radius);
                    assert.equal(f.panel.style, style);
                    assert.equal(f.extension._revision, revision);
                    assert.equal(f.extension._applySource, applyId);
                    assert.equal(f.extension._refreshSource, 0);
                    assert.equal(f.extension._blurSurfaces.get(f.panel), layers[0]);
                    assert.equal(f.extension._blurSurfaces.get(f.background), layers[1]);
                    assert.ok(layers.every(layer => layer.surface.visible && !layer.destroyed));
                    assert.deepEqual([...f.timers.values()].map(timer => timer.delay), [2000]);
                }
            }
            fireTimer(f, applyId);
            f.laters.flush();
            assert.ok(blurs.every(blur => blur.radius === 80));
            assert.equal(f.extension._revision, revision + 1);
            f.extension.disable();
        }
    }
});

test('关闭动画或手势反向时同一帧只刷新一次，状态以最后一个概览信号为准', async () => {
    const f = await fixture();
    f.values['performance-protection'] = true;
    f.extension._commitSettings();
    f.laters.flush();
    const applyEffects = f.extension._applyEffects.bind(f.extension);
    let refreshes = 0;
    f.extension._applyEffects = snapshot => { refreshes++; applyEffects(snapshot); };
    const blur = f.extension._blurSurfaces.get(f.panel).surface.get_effect(f.BLUR_EFFECT_NAME);
    for (const signals of [
        ['showing', 'shown', 'hiding', 'hidden'],
        ['showing', 'hiding', 'hidden', 'showing'],
    ]) {
        const before = refreshes;
        for (const signal of signals)
            f.Main.overview.emit(signal);
        f.panel.set_style(null);
        assert.equal(f.laters.callbacks.size, 1);
        f.laters.flush();
        f.laters.flush();
        assert.equal(refreshes, before + 1);
        const animating = signals.at(-1) === 'showing';
        assert.equal(f.extension._overviewAnimating, animating);
        assert.equal(blur.radius, animating ? Math.round(34 * 0.55) : 34);
        assert.match(f.panel.style, /transition-duration: 0ms/);
        assert.equal(f.timers.size, 0);
    }
    f.extension.disable();
    f.Main.overview.emit('hidden');
    assert.equal(f.laters.callbacks.size, 0);
});

test('概览重复刷新相同参数不重复写入或重建效果，原始模式保留系统过渡', async () => {
    const f = await fixture();
    const hostStyle = 'transition-duration: 250ms;background-color: black;';
    f.panel.set_style(hostStyle);
    f.extension._commitSettings();
    f.laters.flush();
    const layer = f.extension._blurSurfaces.get(f.panel);
    const blur = layer.surface.get_effect(f.BLUR_EFFECT_NAME);
    const repaints = blur.repaints;
    let styleWrites = 0;
    layer.surface.connect('notify::style', () => styleWrites++);
    for (const signal of ['showing', 'shown', 'hiding', 'hidden']) {
        f.Main.overview.emit(signal); // Protection is off in this fixture.
        f.laters.flush();
        f.laters.flush();
        assert.equal(f.extension._blurSurfaces.get(f.panel), layer);
        assert.equal(blur.repaints, repaints);
        assert.equal(styleWrites, 0);
        assert.equal(f.runtime().targets.dock, 'applied');
    }
    assert.match(f.panel.style, /transition-duration: 0ms/);
    f.values['dock-effect'] = 'original';
    f.extension._commitSettings();
    assert.equal(f.panel.style, hostStyle);
    f.Main.overview.emit('hiding');
    f.Main.overview.emit('hidden');
    f.panel.set_style(null);
    f.laters.flush();
    assert.equal(f.panel.style, null, 'Original mode must not fight Shell styling');
    assert.equal(f.extension._blurSurfaces.has(f.panel), false);
    f.extension.disable();
    assert.equal(f.panel.style, null);
});
