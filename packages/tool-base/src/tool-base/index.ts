// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `@openliri/tool-base` 公共出口 —— 工具基类契约与副作用/能力/风险派生。
 *
 * 只承载**与 app 无关**的契约实现：不触碰 ToolManager 单例、不做注册。
 * 工具实现（无论留在 app 还是其它包）通过 `BaseTool` 继承。
 */

export * from './BaseTool';
export * from './toolEffects';
export * from './toolCapability';
export * from './toolRiskClass';
