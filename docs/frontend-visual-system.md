# FusionGo 前端视觉系统

本项目使用 `immersive-glass-ui` 作为用户端酒店、机票预订体验的材质系统。运营后台的数据表格和高密度内容仍采用近实色表面，以可读性为优先。

## 材质层级

1. 旅行摄影背景：酒店、航班各自使用宽幅场景图。
2. 氛围层：局部深色渐变 scrim，保证标题与控件对比度稳定。
3. 深色主玻璃：浮动胶囊导航、产品分段选择、搜索台。
4. 嵌套控制：使用更密的半透明填充，不重复使用 `backdrop-filter`。
5. 激活材料：indigo/violet 用于选择、焦点、链接与主要 CTA。
6. 浅色浮层：目的地联想、旅客选择、联系人和订单确认。

## 主要令牌

| 令牌 | 当前值 |
|---|---|
| Accent | `#5b55f6` |
| Accent hover | `#4b46e5` |
| Dark ink | `#10172a` |
| Dark glass | `rgba(13, 18, 31, .58)` |
| Light glass | `rgba(246, 248, 252, .82)` |
| Dark blur | `26px / 126% saturation` |
| Light blur | `22px / 118% saturation` |
| Shell radius | `32px` |
| Panel radius | `22px` |
| Control radius | `16px` |

玻璃表面同时包含环境色、半透明填充、细边缘、顶部 inset highlight 和外部软阴影。模糊只施加在导航、搜索壳和浮层等主要深度层，不为每个子元素重复叠加。

## 状态与可访问性

- Hover：提高边缘亮度和表面密度，并保持轻微位移。
- Focus：使用 2px violet 焦点环及 offset。
- Active：使用饱和 violet 填充和更强的文字对比。
- Disabled：降低表面对比，保留可读标签，不只调整透明度。
- Loading：保持按钮几何尺寸并显示旋转进度。
- Error：红色边缘、独立错误文案及 `role="alert"`。
- 弹窗使用 `role="dialog"`、`aria-modal`，支持 Escape 和点击遮罩关闭。
- 搜索结果表格、酒店和航班列表保持近实色，避免长内容受背景采样影响。

## 响应式

- `760px` 以下搜索台变为垂直堆叠，CTA 为全宽。
- 浮层在移动端使用固定定位和 16px 安全边距。
- 移动导航只保留酒店与机票主入口。
- 页面切换自动回到顶部。
- 运营后台表格允许横向滚动，不压缩关键信息。

## 浏览器降级

- 使用 `@supports not (backdrop-filter)` 将深色玻璃替换为 96% 不透明深色表面，浅色玻璃替换为 98% 不透明浅色表面。
- `prefers-reduced-motion: reduce` 下关闭非必要动画与平滑滚动。
- `prefers-contrast: more` 下加密表面并提高边界、文字对比。
- `forced-colors: active` 下交还系统配色并保留清晰边框。

