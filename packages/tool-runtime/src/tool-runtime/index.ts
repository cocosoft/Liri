// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `@openliri/tool-runtime` 公共出口 —— 工具运行时支撑。
 *
 * 两个共享件，均为浏览器域与桌面域工具类所需：
 * - `toolFeatureGate`：工具级用户可配开关（`BROWSER` / `COMPUTER_USE`）；
 * - `visionAnalyze`：截图交给 `RouteKey.IMAGE_ANALYZE` 路由的视觉 Provider。
 *
 * 归 app 层：依赖 `@modules/query/featureGate` 与 `@modules/ai`（均为 app 层）。
 */

export * from './toolFeatureGate';
export * from './visionAnalyze';
