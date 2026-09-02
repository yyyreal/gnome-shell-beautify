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
    emit(signal) {
        for (const [id, handler] of [...this.signals]) {
            if (this.signals.has(id) && handler.signal === signal)
                handler.callback(this);
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
    set_style(style) { this.style = style; }
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
            timers.set(++timerId, {delay, callback});
            return timerId;
        },
    };
    const Main = {panel, uiGroup, layoutManager: {panelBox, overviewGroup}, overview: {dash}};
    const context = vm.createContext({console, global: {stage, compositor: {get_laters: () => laters}}});
    const Clutter = {FixedLayout: class FixedLayout {}, ActorAlign: {START: 'START'}};
    const Meta = {BackgroundGroup: Actor, LaterType: {BEFORE_REDRAW: 'BEFORE_REDRAW'}};
    const St = {Widget: Actor};
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
        ['resource:///org/gnome/shell/extensions/extension.js', synthetic({Extension: class {}})],
        ['resource:///org/gnome/shell/ui/main.js', synthetic(Main)],
        ['./i18n.js', synthetic({getTranslator: () => text => text})],
    ]);
    const layerModule = new vm.SourceTextModule(
        await readFile(new URL('../blurSurface.js', import.meta.url), 'utf8'), {context});
    mocks.set('./blurSurface.js', layerModule);
    const extensionModule = new vm.SourceTextModule(
        await readFile(new URL('../extension.js', import.meta.url), 'utf8'), {context});
    await extensionModule.link(specifier => {
        if (!mocks.has(specifier))
            mocks.set(specifier, synthetic({}));
        return mocks.get(specifier);
    });
    await extensionModule.evaluate();
    const extension = new extensionModule.namespace.default();
    const values = {
        'linked-targets': false, 'battery-reduce': false, 'apply-delay': 2000,
    };
    for (const prefix of ['dock', 'app']) {
        Object.assign(values, {
            [`${prefix}-effect`]: 'blur', [`${prefix}-opacity`]: 62,
            [`${prefix}-blur-radius`]: 34, [`${prefix}-brightness`]: 92,
            [`${prefix}-corner-radius`]: 18, [`${prefix}-border-width`]: 1,
            [`${prefix}-shadow-strength`]: 20, [`${prefix}-tint`]: 18,
        });
    }
    extension._settings = {
        get_boolean: key => values[key], get_int: key => values[key], get_string: key => values[key],
    };
    extension._originalActors = new Map();
    extension._blurSurfaces = new Map();
    extension._isDarkTheme = () => true;
    extension._scheduleIndicatorSync = () => {};
    return {extension, values, Main, stage, panel, panelBox, uiGroup, overviewGroup,
        overviewActor, controls, dash, background, laters, timers, ...layerModule.namespace};
}

test('顶部模糊层不能加入 panelBox，也不能使栏位高度翻倍', async () => {
    const f = await fixture();
    f.extension._applyEffects();
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
    f.extension._applyEffects();
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
    f.extension._applyEffects();
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
    f.extension._applyEffects();
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
    f.extension._applyEffects();
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
    f.extension._applyEffects();
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
    f.extension._applyEffects();
    assert.equal(dashBlur.radius, 0);
    assert.equal(f.extension._blurSurfaces.get(f.background), dashLayer);
    assert.ok(dashBlur.repaints >= 2);
    f.values['linked-targets'] = true;
    f.extension._applyEffects();
    assert.equal(dashBlur.radius, 12);
    assert.equal(dashBlur.brightness, 0.92);
});

test('隐藏/未分配/渐隐的目标不能留下漂浮的模糊条', async () => {
    const f = await fixture();
    f.extension._applyEffects();
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
        f.extension._applyEffects();
        const old = f.extension._blurSurfaces.get(f.panel);
        f.values['dock-effect'] = effect;
        f.values['dock-opacity'] = transparency;
        f.extension._applyEffects();
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
    f.extension._applyEffects();
    const layer = f.extension._blurSurfaces.get(f.background);
    layer.group.destroy();
    assert.ok(layer.destroyed);
    assert.equal(f.extension._blurSurfaces.has(f.background), false);
    f.extension._applyEffects();
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
    f.extension._applyEffects();
    const layer = f.extension._blurSurfaces.get(f.background);
    f.overviewGroup.remove_child(f.overviewActor);
    f.uiGroup.add_child(f.overviewActor);
    f.laters.flush();
    assert.ok(layer.destroyed);
    f.extension._applyEffects();
    const replacement = f.extension._blurSurfaces.get(f.background);
    assert.notEqual(replacement, layer);
    assert.equal(replacement.parent, f.uiGroup);
});
