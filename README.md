# Gnome美化

为 GNOME Shell 的 Dock（顶部系统栏）与应用程序栏（概览中的应用图标栏）提供独立或联动的背景美化效果。

## 功能

- 原始、透明、模糊、磨砂玻璃、纯色、渐变六种效果
- Dock 与应用程序栏联动或独立配置
- 模糊半径、透明度、亮度、色调、渐变和外观细节参数
- 所有效果统一采用 `0% = 完全不透明、100% = 完全透明`
- Dock 快捷图标，可弹出快速效果菜单并进入设置
- 停止调整后延迟应用，减少连续重绘
- 中文、英文及跟随系统语言
- 性能保护、电池模式、预设导入导出和恢复默认

## 支持版本

GNOME Shell 46–51。扩展仅面向 GNOME 46 及以上版本。

## 安装

```bash
gnome-extensions install gnome-beautify@yyyreal.github.com-v1.0.7.zip --force
```

注销并重新登录后启用：

```bash
gnome-extensions enable gnome-beautify@yyyreal.github.com
```

## 1.0.7 修复与验证

- 模糊背景层不再插入顶部栏的纵向布局，避免额外增加一行。
- 采样层移到 Dash 的离屏渲染区域外；Ubuntu 自带 Dock 的采样层保留在滑动、裁剪容器内。
- 仅绘制层跟随背景的位置、尺寸、缩放和显隐，包装容器固定为零尺寸，不复制目标的布局请求。
- 打包前运行 `node --experimental-vm-modules --test tests/blur-surface.test.mjs`。

自动测试覆盖 Actor 层级、零占位、坐标换算、半径/联动/延迟应用、显隐和销毁清理，
不等同于 GNOME 的 GPU 渲染测试。实机检查时，使用有细节的壁纸，透明度设为 60%，
分别将模糊与磨砂半径从 0 调到 60，停止调整后等待设置的应用延迟；检查顶部没有多出
横条，应用程序栏图标仍清晰，并检查隐藏、重新显示及禁用扩展后的恢复情况。

## 作者

- Real April
- GitHub: <https://github.com/yyyreal/gnome-beautify.git>
- 邮箱：<c070533@qq.com>
