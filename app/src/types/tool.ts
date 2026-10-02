/**
 * AppState 侧的工具**宽松引用**与**宽松权限上下文**（原为极简 `Tool` / `ToolPermissionContext`）。
 *
 * 2026-10-01 数据契约专项 U5（并入 U3-② 乙）：原极简版与 `tools/types` 的**完整契约**同名但
 * **形状不兼容** —— `parameters` vs `params`；权限上下文缺 `mode` / `additionalWorkingDirectories`
 * / `alwaysAllowRules` / `alwaysDenyRules` / `alwaysAskRules`（实测 `TS2352`）⇒ 依 §9.2 原则 2
 * 「一个名字只允许一个规范落点」**改名**，保留其"仅作字段声明、从不解引用字段"的占位职责。
 *
 * ⚠️ 若将来 AppState 改为按完整契约取用，应直接改用 `@modules/tools/types`
 * （`appState` → `tools` 同属 app ⇒ 合法），届时本文件可整体删除。
 */
export interface AppStateToolRef {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute?(
    input: Record<string, unknown>,
    context: AppStateToolPermissionContext
  ): Promise<unknown>;
}

export interface AppStateToolPermissionContext {
  allowed: boolean;
  permissionLevel: string;
  isBypassPermissionsModeAvailable?: boolean;
  isBypassPermissionsModeEnabled?: boolean;
  circuitBroken?: boolean;
  circuitBrokenAt?: number;
  alwaysAllowRules?: Record<string, unknown>;
  alwaysDenyRules?: Record<string, unknown>;
  alwaysAskRules?: Record<string, unknown>;
  mode?: string;
}
