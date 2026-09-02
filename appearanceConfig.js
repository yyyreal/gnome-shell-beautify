export const TARGET_SUFFIXES = [
    'effect', 'blur-radius', 'opacity', 'brightness', 'tint', 'color',
    'gradient-start', 'gradient-end', 'gradient-direction',
    'corner-radius', 'border-width', 'shadow-strength',
];

const STRING_SUFFIXES = new Set(['effect', 'color', 'gradient-start', 'gradient-end']);

export function effectivePrefix(settings, target) {
    return target === 'app' && settings.get_boolean('linked-targets') ? 'dock' : target;
}

export function effectiveKey(settings, target, suffix) {
    return `${effectivePrefix(settings, target)}-${suffix}`;
}

export function watchEffectiveSetting(settings, target, suffix, callback) {
    return settings.connect('changed', (_settings, key) => {
        if (key === 'linked-targets' || key === effectiveKey(settings, target, suffix))
            callback();
    });
}

export function readSnapshot(settings) {
    const readTarget = prefix => Object.freeze(Object.fromEntries(TARGET_SUFFIXES.map(suffix => [
        suffix, STRING_SUFFIXES.has(suffix)
            ? settings.get_string(`${prefix}-${suffix}`)
            : settings.get_int(`${prefix}-${suffix}`),
    ])));
    const linked = settings.get_boolean('linked-targets');
    const dock = readTarget('dock');
    return Object.freeze({
        linked,
        dock,
        // Linked targets share the very same immutable configuration object.
        app: linked ? dock : readTarget('app'),
        performanceProtection: settings.get_boolean('performance-protection'),
        batteryReduce: settings.get_boolean('battery-reduce'),
    });
}

export function snapshotKey(snapshot) {
    return JSON.stringify(snapshot);
}

export function runtimeSummary(settings, request, _) {
    let status;
    try {
        status = JSON.parse(settings.get_string('runtime-status'));
    } catch {
        return _('等待扩展响应，请确认扩展已启用');
    }
    // A persisted success from an earlier Shell session is not an acknowledgement.
    if (!request || status?.request !== request)
        return _('等待扩展响应，请确认扩展已启用');
    if (!status.active)
        return _('扩展未启用');
    if (status.pending || status.configKey !== snapshotKey(readSnapshot(settings)))
        return _('等待应用最新设置…');
    const labels = {
        applied: _('配置已应用'), hidden: _('已配置，等待目标显示'),
        waiting: _('等待背景就绪'), missing: _('未找到目标'),
        failed: status.retrying ? _('应用失败，正在重试') : _('应用失败，请重新调整或启用扩展'),
    };
    return `Dock: ${labels[status.targets?.dock] ?? labels.waiting} · ` +
        `${_('应用程序栏')}: ${labels[status.targets?.app] ?? labels.waiting}`;
}
