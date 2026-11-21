// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `@openliri/tool-browser` 公共出口 —— 浏览器域。
 *
 * - `PlaywrightDriver` / `schemas`：驱动实现与输入输出 schema；
 * - `BrowserTool` / `BrowserVisionTool`：工具类（P4 续，2026-11-21 由 app 迁入）。
 *
 * 注册动作（`builtinToolRegistry`）仍由 app 负责。
 */

export * from './PlaywrightDriver';
export * from './schemas';
// `BrowserTool` 自带的入参/出参 interface 与 `schemas.ts` 的 z.infer 类型同名 ⇒ 只导出类，
// 类型以 schema 派生版本为唯一出口。
export { BrowserTool } from './BrowserTool';
export { BrowserVisionTool } from './BrowserVisionTool';
