const translations = {
  zh: {
    activities: '活动', windowSubtitle: 'Dock 与应用程序栏背景', general: '通用', applications: '应用程序栏', advanced: '高级', about: '关于',
    original: '原始', transparent: '透明', blur: '模糊', glass: '磨砂玻璃', solid: '纯色', gradient: '渐变', intensity: '强度', radius: '半径', openSettings: '打开设置',
    preview: '实时预览', dockDescription: '设置桌面 Dock 的背景样式', applicationsDescription: '设置应用程序概览底部栏的背景样式', scope: '应用范围', linkTitle: '联动 Dock 与应用程序栏', linkSubtitle: '关闭后可分别设置两处效果', linked: '已联动', independent: '独立设置', backgroundEffect: '背景效果',
    blurParameters: '模糊参数', glassParameters: '磨砂玻璃参数', transparentParameters: '透明参数', solidParameters: '纯色参数', gradientParameters: '渐变参数', originalParameters: '原始效果', noParameters: '原始效果不需要额外参数。',
    blurRadius: '模糊半径', opacity: '透明度', brightness: '亮度', tint: '色调强度', color: '背景颜色', colorStart: '起始颜色', colorEnd: '结束颜色', direction: '渐变方向', effectPreview: '效果预览', autoApply: '停止调整 2 秒后自动应用', waiting: '等待停止调整…', applying: '正在应用效果…', applied: '效果已应用', gpuWarning: '背景模糊可能增加 GPU 占用', details: '外观细节', corner: '圆角', border: '边框', shadow: '阴影',
    generalDescription: '设置语言、应用方式与默认行为', language: '语言', displayLanguage: '界面语言', languageSubtitle: '自动选项会跟随系统语言', behavior: '应用行为', delay: '调整延迟', delaySubtitle: '停止操作后再应用效果', remember: '记住最后一次效果', rememberSubtitle: '登录后恢复上次使用的配置', indicator: '显示 Dock 快捷图标', indicatorSubtitle: '用于快速切换效果和打开设置',
    advancedDescription: '性能、兼容性与配置管理', performance: '性能', performanceMode: '性能保护', performanceSubtitle: '在概览动画期间临时降低模糊半径', batteryMode: '电池模式下降低效果', batterySubtitle: '使用电池时优先减少 GPU 占用', presets: '预设与恢复', export: '导出预设', import: '导入预设', reset: '恢复默认',
    manifestDescription: '为 GNOME Shell 的 Dock 与应用程序栏提供独立或联动的透明、模糊、磨砂、纯色与渐变背景效果。', author: '作者', email: '邮箱', emailPending: '待提供', localization: '本地化', resetCurrent: '恢复当前页面默认值', saved: '设置已保存',
    exportDone: '预设已导出', importDone: '预设已导入', importError: '无法读取该预设文件', resetDone: '已恢复默认设置', quickTargetLinked: 'Dock + 应用程序栏', quickTargetDock: 'Dock 独立设置', quickTargetApps: '应用程序栏独立设置'
  },
  en: {
    activities: 'Activities', windowSubtitle: 'Dock & App Grid Backgrounds', general: 'General', applications: 'App Grid Bar', advanced: 'Advanced', about: 'About',
    original: 'Original', transparent: 'Clear', blur: 'Blur', glass: 'Frosted', solid: 'Solid', gradient: 'Gradient', intensity: 'Intensity', radius: 'Radius', openSettings: 'Open Settings',
    preview: 'Live preview', dockDescription: 'Style the desktop Dock background', applicationsDescription: 'Style the bottom bar in the app overview', scope: 'Apply to', linkTitle: 'Link Dock and App Grid Bar', linkSubtitle: 'Turn off to configure each surface separately', linked: 'Linked', independent: 'Independent', backgroundEffect: 'Background effect',
    blurParameters: 'Blur parameters', glassParameters: 'Frosted glass parameters', transparentParameters: 'Transparency parameters', solidParameters: 'Solid color parameters', gradientParameters: 'Gradient parameters', originalParameters: 'Original effect', noParameters: 'The original effect has no additional parameters.',
    blurRadius: 'Blur radius', opacity: 'Opacity', brightness: 'Brightness', tint: 'Tint strength', color: 'Background color', colorStart: 'Start color', colorEnd: 'End color', direction: 'Direction', effectPreview: 'Effect preview', autoApply: 'Apply 2 seconds after adjustments stop', waiting: 'Waiting for adjustments to stop…', applying: 'Applying effect…', applied: 'Effect applied', gpuWarning: 'Background blur may increase GPU usage', details: 'Appearance details', corner: 'Corners', border: 'Border', shadow: 'Shadow',
    generalDescription: 'Language, apply timing, and default behavior', language: 'Language', displayLanguage: 'Display language', languageSubtitle: 'Automatic follows your system language', behavior: 'Behavior', delay: 'Apply delay', delaySubtitle: 'Apply after you stop adjusting controls', remember: 'Remember the last effect', rememberSubtitle: 'Restore the last configuration after login', indicator: 'Show quick-access Dock icon', indicatorSubtitle: 'Switch effects and open settings quickly',
    advancedDescription: 'Performance, compatibility, and presets', performance: 'Performance', performanceMode: 'Performance protection', performanceSubtitle: 'Temporarily reduce blur during overview animations', batteryMode: 'Reduce effects on battery', batterySubtitle: 'Prefer lower GPU usage when on battery power', presets: 'Presets & reset', export: 'Export preset', import: 'Import preset', reset: 'Reset all',
    manifestDescription: 'Independent or linked transparent, blurred, frosted, solid, and gradient backgrounds for the GNOME Shell Dock and App Grid Bar.', author: 'Author', email: 'Email', emailPending: 'Not provided', localization: 'Localization', resetCurrent: 'Reset current page', saved: 'Settings saved',
    exportDone: 'Preset exported', importDone: 'Preset imported', importError: 'Could not read this preset file', resetDone: 'Default settings restored', quickTargetLinked: 'Dock + App Grid Bar', quickTargetDock: 'Dock — independent', quickTargetApps: 'App Grid Bar — independent'
  }
};

const defaults = () => ({
  linked: true,
  currentTarget: 'dock',
  delay: 2000,
  language: 'auto',
  dock: { effect: 'blur', radius: 34, opacity: 62, brightness: 92, tint: 18, color: '#544d42', colorStart: '#5a416d', colorEnd: '#8c425f', direction: 100, corner: 18, border: 1, shadow: 20 },
  applications: { effect: 'blur', radius: 34, opacity: 62, brightness: 92, tint: 18, color: '#544d42', colorStart: '#5a416d', colorEnd: '#8c425f', direction: 100, corner: 18, border: 1, shadow: 20 }
});

let state = defaults();
let applyTimer;
let toastTimer;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const currentLanguage = () => state.language === 'auto' ? (navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en') : state.language;
const t = key => translations[currentLanguage()][key] || key;
const currentConfig = () => state[state.currentTarget];
const configsToUpdate = () => state.linked ? [state.dock, state.applications] : [currentConfig()];

function setLanguage() {
  const lang = currentLanguage();
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  $$('[data-i18n]').forEach(node => { node.textContent = translations[lang][node.dataset.i18n] || node.textContent; });
  renderTargetContext();
  renderParameters();
}

function renderTargetContext() {
  const apps = state.currentTarget === 'applications';
  $('#pageTitle').textContent = apps ? t('applications') : 'Dock';
  $('#pageDescription').textContent = apps ? t('applicationsDescription') : t('dockDescription');
  $$('.target-card').forEach(card => {
    card.classList.toggle('active', card.dataset.target === state.currentTarget);
    $('em', card).textContent = state.linked ? t('linked') : t('independent');
  });
  $('#quickTargetLabel').textContent = state.linked ? t('quickTargetLinked') : (apps ? t('quickTargetApps') : t('quickTargetDock'));
}

function renderEffects() {
  const effect = currentConfig().effect;
  $$('#effectGrid button').forEach(button => {
    button.classList.toggle('active', button.dataset.effect === effect);
    if (button.dataset.effect === effect && !$('.check', button)) {
      const check = document.createElement('span'); check.className = 'check'; check.textContent = '✓'; button.prepend(check);
    }
  });
  $$('.quick-effects button').forEach(button => button.classList.toggle('active', button.dataset.quickEffect === effect));
  $('#quickRadiusRow').classList.toggle('hidden', !['blur', 'glass'].includes(effect));
}

const parameterDefinitions = {
  blur: [['radius','blurRadius',0,80,'px'],['opacity','opacity',0,100,'%'],['brightness','brightness',40,120,'%']],
  glass: [['radius','blurRadius',0,80,'px'],['opacity','opacity',0,100,'%'],['tint','tint',0,100,'%']],
  transparent: [['opacity','opacity',0,100,'%']],
  solid: [['opacity','opacity',0,100,'%'],['color','color']],
  gradient: [['opacity','opacity',0,100,'%'],['direction','direction',0,360,'°'],['colorStart','colorStart'],['colorEnd','colorEnd']],
  original: []
};

function renderParameters() {
  const cfg = currentConfig();
  const titleKeys = {blur:'blurParameters',glass:'glassParameters',transparent:'transparentParameters',solid:'solidParameters',gradient:'gradientParameters',original:'originalParameters'};
  $('#parameterTitle').textContent = t(titleKeys[cfg.effect]);
  const rows = $('#parameterRows'); rows.replaceChildren();
  const defs = parameterDefinitions[cfg.effect];
  if (!defs.length) {
    const row = document.createElement('div'); row.className = 'parameter-row'; row.style.gridTemplateColumns = '1fr'; row.textContent = t('noParameters'); rows.append(row);
  }
  defs.forEach(([key,label,min,max,unit]) => {
    const labelNode = document.createElement('label'); labelNode.className = 'parameter-row'; labelNode.dataset.key = key;
    const name = document.createElement('span'); name.textContent = t(label);
    let input;
    if (key.startsWith('color')) { input = document.createElement('input'); input.type = 'color'; input.value = cfg[key]; }
    else { input = document.createElement('input'); input.type = 'range'; input.min = min; input.max = max; input.value = cfg[key]; }
    input.dataset.parameter = key;
    const output = document.createElement('output'); output.textContent = key.startsWith('color') ? cfg[key].toUpperCase() : `${cfg[key]}${unit === '%' || unit === '°' ? unit : ` ${unit}`}`;
    labelNode.append(name,input,output); rows.append(labelNode);
  });
  $$('[data-parameter]', rows).forEach(input => input.addEventListener('input', event => updateParameter(event.target.dataset.parameter, event.target.value, event.target)));
  $('#quickOpacity').value = cfg.opacity; $('#quickOpacityValue').textContent = `${cfg.opacity}%`;
  $('#quickRadius').value = cfg.radius; $('#quickRadiusValue').textContent = `${cfg.radius} px`;
  $('#cornerRadius').value = cfg.corner; $('#cornerRadius').nextElementSibling.textContent = `${cfg.corner} px`;
  $('#borderWidth').value = cfg.border; $('#borderWidth').nextElementSibling.textContent = `${cfg.border} px`;
  $('#shadowStrength').value = cfg.shadow; $('#shadowStrength').nextElementSibling.textContent = `${cfg.shadow}%`;
  updatePreview(); renderEffects();
  $('#gpuWarning').classList.toggle('hidden', !['blur','glass'].includes(cfg.effect));
}

function updateParameter(key, rawValue, input) {
  const value = key.startsWith('color') ? rawValue : Number(rawValue);
  configsToUpdate().forEach(cfg => { cfg[key] = value; });
  const output = input.nextElementSibling;
  if (output) output.textContent = key.startsWith('color') ? value.toUpperCase() : `${value}${key === 'radius' ? ' px' : key === 'direction' ? '°' : '%'}`;
  if (key === 'opacity') { $('#quickOpacity').value = value; $('#quickOpacityValue').textContent = `${value}%`; }
  if (key === 'radius') { $('#quickRadius').value = value; $('#quickRadiusValue').textContent = `${value} px`; }
  updatePreview(); scheduleApply();
}

function updatePreview() {
  const cfg = currentConfig();
  const preview = $('.preview-surface');
  const backgroundAlpha = Math.max(0, 1 - cfg.opacity / 100);
  preview.className = `preview-surface ${cfg.effect}`;
  preview.style.borderRadius = `${cfg.corner}px`;
  preview.style.borderWidth = `${cfg.border}px`;
  preview.style.boxShadow = `0 14px 32px rgba(0,0,0,${cfg.shadow / 100})`;
  preview.style.opacity = 1;
  preview.style.backdropFilter = '';
  preview.style.background = '';
  if (cfg.effect === 'transparent') preview.style.background = `rgba(36,31,46,${backgroundAlpha})`;
  if (cfg.effect === 'blur') { preview.style.background = `rgba(48,46,56,${backgroundAlpha})`; preview.style.backdropFilter = backgroundAlpha > 0 ? `blur(${cfg.radius}px) brightness(${cfg.brightness / 100})` : ''; }
  if (cfg.effect === 'glass') { preview.style.background = `rgba(102,82,126,${backgroundAlpha})`; preview.style.backdropFilter = backgroundAlpha > 0 ? `blur(${cfg.radius}px) brightness(1)` : ''; preview.style.boxShadow = 'none'; }
  if (cfg.effect === 'solid') preview.style.background = hexToRgba(cfg.color, backgroundAlpha);
  if (cfg.effect === 'gradient') preview.style.background = `linear-gradient(${cfg.direction}deg, ${hexToRgba(cfg.colorStart, backgroundAlpha)}, ${hexToRgba(cfg.colorEnd, backgroundAlpha)})`;
  $('#desktopDock').style.borderRadius = `${Math.max(10,cfg.corner + 4)}px`;
  $('#desktopDock').style.opacity = 1;
  $('#desktopDock').style.backgroundColor = `rgba(29,28,35,${backgroundAlpha})`;
  $('#desktopDock').style.backdropFilter = ['blur','glass'].includes(cfg.effect) && backgroundAlpha > 0 ? `blur(${Math.min(cfg.radius,30)}px) brightness(${cfg.effect === 'glass' ? 1 : cfg.brightness / 100})` : '';
}

function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '');
  const number = Number.parseInt(value, 16);
  return `rgba(${number >> 16},${number >> 8 & 255},${number & 255},${alpha})`;
}

function scheduleApply() {
  clearTimeout(applyTimer);
  const status = $('#applyStatus');
  status.className = 'apply-status pending'; $('.status-icon', status).textContent = '◌'; status.lastElementChild.textContent = t('waiting');
  $('#footerState').lastElementChild.textContent = t('waiting');
  applyTimer = setTimeout(() => {
    status.lastElementChild.textContent = t('applying');
    setTimeout(() => {
      status.className = 'apply-status applied'; $('.status-icon', status).textContent = '✓'; status.lastElementChild.textContent = t('applied');
      $('#footerState').lastElementChild.textContent = t('saved');
    }, 260);
  }, state.delay);
}

function showPage(page) {
  $$('.sidebar button').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  $$('.preferences-page').forEach(section => section.classList.add('hidden'));
  if (page === 'dock' || page === 'applications') {
    state.currentTarget = page === 'dock' ? 'dock' : 'applications';
    $('#appearancePage').classList.remove('hidden'); renderTargetContext(); renderParameters();
  } else {
    $(`#${page}Page`).classList.remove('hidden');
  }
  $('#resetCurrent').classList.toggle('hidden', page === 'about');
}

function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 1800);
}

function exportPreset() {
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'gnome-beautify-preset.json'; link.click(); URL.revokeObjectURL(url); toast(t('exportDone'));
}

function loadPreset(file) {
  const reader = new FileReader();
  reader.onload = () => { try { state = {...defaults(), ...JSON.parse(reader.result)}; $('#linkTargets').checked = state.linked; $('#languageSelect').value = state.language; $('#delaySelect').value = String(state.delay); setLanguage(); renderTargetContext(); renderParameters(); toast(t('importDone')); } catch { toast(t('importError')); } };
  reader.readAsText(file);
}

$$('.sidebar button').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));
$$('.target-card').forEach(button => button.addEventListener('click', () => { if (!state.linked) showPage(button.dataset.target === 'dock' ? 'dock' : 'applications'); }));
$('#linkTargets').addEventListener('change', event => { state.linked = event.target.checked; if (state.linked) state.applications = {...state.dock}; renderTargetContext(); renderParameters(); scheduleApply(); });
$$('#effectGrid button').forEach(button => button.addEventListener('click', () => { configsToUpdate().forEach(cfg => cfg.effect = button.dataset.effect); renderParameters(); scheduleApply(); }));
$$('.quick-effects button').forEach(button => button.addEventListener('click', () => { configsToUpdate().forEach(cfg => cfg.effect = button.dataset.quickEffect); renderParameters(); scheduleApply(); }));
$('#quickOpacity').addEventListener('input', event => updateParameter('opacity', event.target.value, event.target));
$('#quickRadius').addEventListener('input', event => updateParameter('radius', event.target.value, event.target));
[['cornerRadius','corner',' px'],['borderWidth','border',' px'],['shadowStrength','shadow','%']].forEach(([id,key,unit]) => { $(`#${id}`).addEventListener('input', event => { configsToUpdate().forEach(cfg => cfg[key] = Number(event.target.value)); event.target.nextElementSibling.textContent = `${event.target.value}${unit}`; updatePreview(); scheduleApply(); }); });
$('#languageSelect').addEventListener('change', event => { state.language = event.target.value; setLanguage(); });
$('#delaySelect').addEventListener('change', event => { state.delay = Number(event.target.value); scheduleApply(); });
$('#extensionButton').addEventListener('click', () => $('#quickPopover').classList.toggle('closed'));
$('#closeQuick').addEventListener('click', () => $('#quickPopover').classList.add('closed'));
$('#openSettings').addEventListener('click', () => { $('#settingsWindow').classList.remove('closed'); $('#quickPopover').classList.add('closed'); });
$('#closeSettings').addEventListener('click', () => $('#settingsWindow').classList.add('closed'));
$('#minimizeSettings').addEventListener('click', () => $('#settingsWindow').classList.add('closed'));
$('#exportPreset').addEventListener('click', exportPreset);
$('#importPreset').addEventListener('click', () => $('#presetFile').click());
$('#presetFile').addEventListener('change', event => { if (event.target.files[0]) loadPreset(event.target.files[0]); });
$('#resetAll').addEventListener('click', () => { state = defaults(); $('#linkTargets').checked = true; $('#languageSelect').value = 'auto'; $('#delaySelect').value = '2000'; setLanguage(); showPage('dock'); toast(t('resetDone')); });
$('#resetCurrent').addEventListener('click', () => { const fresh = defaults()[state.currentTarget]; configsToUpdate().forEach(cfg => Object.assign(cfg,fresh)); renderParameters(); scheduleApply(); toast(t('resetDone')); });

setLanguage();
renderTargetContext();
renderParameters();
