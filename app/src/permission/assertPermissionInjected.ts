// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * D2（2026-10-11 用户裁定「启动 fail-fast 断言」）—— 权限管理器**注入断言**。
 *
 * 背景（G9）：`ToolExecutionService` 在**权限管理器未注入**时是 **fail-open** ——
 * 旧行为"静默跳过权限检查仍执行"（2026-10-08 仅补 warn，语义未变）。而生产路径
 * （`runtime/api/llmChatOps.ts`）**恒注入** `createPermissionManager()` ⇒ 未注入即
 * **装配异常**，不应继续以"无权限检查"姿态执行工具。
 *
 * 处置：生产/开发路径改为 **fail-fast** —— 未注入即**抛错拒绝执行**；测试路径
 * （`NODE_ENV==='test'`）保留 fail-open（大量单测不注入权限管理器为既有约定）。
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

/**
 * 断言权限管理器已注入（未注入 ⇒ 抛 `AppError`，**fail-fast**）。
 *
 * @param manager 待校验的权限管理器（`null`/`undefined` 视为未注入）
 * @param context 触发点描述（写入错误 detail，便于定位装配缺口）
 * @throws AppError（`PERMISSION_MANAGER_NOT_INJECTED`）当未注入且非测试环境
 */
export function assertPermissionManagerInjected(
  manager: unknown,
  context: string
): void {
  if (manager) return;
  // 测试环境保留 fail-open（既有约定：单测常不注入）；生产/开发路径 fail-fast。
  if (process.env.NODE_ENV === 'test') return;
  throw new AppError(
    `权限管理器未注入（上下文: ${context}）—— 生产路径应经 createPermissionManager() 注入；` +
      '此为装配错误，拒绝在「无权限检查」下继续执行（D2 fail-fast）',
    ErrorCategory.VALIDATION,
    ErrorSeverity.HIGH,
    'PERMISSION_MANAGER_NOT_INJECTED',
    { context }
  );
}
