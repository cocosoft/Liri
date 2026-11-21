// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `@openliri/tool-browser` 公共出口 —— 浏览器驱动与 schema。
 *
 * 工具类 `BrowserTool` 留在 app（继承 app 的 `BaseTool`）：本包只承载
 * 与工具基类无关的驱动实现和输入/输出 schema。
 */

export * from './PlaywrightDriver';
export * from './schemas';
