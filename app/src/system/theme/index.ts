// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 主题管理模块导出
 */

export {
  ThemeManager,
  getThemeManager,
  createThemeManager,
} from './ThemeManager';

export type { Theme } from './ThemeManager';

// 2026-10-01（B3-1'）：`ThemeLoader` / `ThemeSchema` 由 `ui/theme/` 并入 canonical
// （实测 infra-safe：仅依赖 fs / path / @modules/{monitoring,core}）⇒ 收敛 theme 域实现。
export { ThemeLoader } from './ThemeLoader';
export * from './ThemeSchema';

// 2026-10-01（B3-1''）：**ANSI 配色 + 显示配置**子系统由 `ui/ThemeManager.ts` 共址至此。
// ⚠️ 它与上面的 `ThemeManager`（**语义主题**：primary/success/warning…）是**两个不同子系统**
// （历史上仅同名，非重复实现）⇒ 改名 `TerminalThemeManager` 以示区分，类型加 `Terminal*` 前缀避免冲突。
export { TerminalThemeManager } from './TerminalThemeManager';
export type {
  Theme as TerminalTheme,
  ThemeColors as TerminalThemeColors,
  ThemeConfig as TerminalThemeConfig,
} from './TerminalThemeManager';
