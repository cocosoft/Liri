// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `@openliri/tool-desktop` 公共出口 —— 桌面自动化工具。
 *
 * `ComputerUseTool`：截图 / 鼠标 / 键盘 / 剪贴板 / 窗口管理；底层驱动在
 * `@openliri/infra/utils/computerUse`（Windows / macOS / Linux 适配器）。
 * 注册动作仍由 app 的 `builtinToolRegistry` 负责。
 */

export * from './ComputerUseTool';
