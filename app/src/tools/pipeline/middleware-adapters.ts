/**
 * 中间件适配器
 *
 * 将 ToolExecutor 现有的 5 层管理器包装为 ToolMiddleware 接口。
 * 各适配器仅做薄层包装，不修改原有逻辑。
 *
 * 注册顺序在 ToolExecutor 初始化时调用 registerMiddleware() 完成。
 */

import type {
  ToolMiddleware,
  PipelineContext,
  MiddlewareResult,
} from './types';
import { MiddlewareGroup } from './types';
import { registerMiddleware } from './PipelineBuilder';
import {
  PermissionManager,
  createPermissionManager,
} from '../../permission/PermissionManager';
import { ToolHookManager } from '@modules/hooks';
import type { ToolHookContext } from '../../hooks/types/ToolHooks';

// ── Permission 中间件适配器 ───────────────────────────────────────────

/**
 * 创建权限检查中间件
 */
export function createPermissionMiddleware(): ToolMiddleware {
  const permissionManager: PermissionManager = createPermissionManager();

  return {
    name: 'PermissionCheck',
    before: async (ctx: PipelineContext): Promise<MiddlewareResult> => {
      // 使用 tool.name 避免 Tool | string 类型不兼容
      const decision = await permissionManager.checkPermission(
        ctx.tool.name,
        ctx.input
      );

      if (decision.type === 'deny') {
        return {
          continue: false,
          error: decision.reason || 'Permission denied',
        };
      }

      ctx.metadata.set('permissionDecision', decision);
      return { continue: true };
    },
  };
}

// ── Hook 中间件适配器 ─────────────────────────────────────────────────

/**
 * 创建 Pre-Hook 中间件
 */
export function createPreHookMiddleware(): ToolMiddleware {
  const hookManager = ToolHookManager.getInstance();

  return {
    name: 'PreHook',
    before: async (ctx: PipelineContext): Promise<MiddlewareResult> => {
      const hookContext: ToolHookContext = {
        toolName: ctx.tool.name,
        toolUseID: ctx.toolUseId,
        input: { ...ctx.input },
        permissionMode: 'auto' as never,
        abortSignal: undefined,
      };

      for await (const hookResult of hookManager.executePreToolUseHooks(
        hookContext
      )) {
        if (hookResult.type === 'hookUpdatedInput' && hookResult.updatedInput) {
          ctx.input = hookResult.updatedInput;
        }
        if (
          hookResult.type === 'hookPermissionResult' &&
          hookResult.permissionBehavior === 'deny'
        ) {
          return { continue: false, error: 'Execution prevented by pre-hook' };
        }
      }

      return { continue: true };
    },
  };
}

/**
 * 创建 Post-Hook 中间件
 */
export function createPostHookMiddleware(): ToolMiddleware {
  const hookManager = ToolHookManager.getInstance();

  return {
    name: 'PostHook',
    before: async (_ctx: PipelineContext): Promise<MiddlewareResult> => {
      // Post-hook 仅在 after 阶段执行
      return { continue: true };
    },
    after: async (ctx: PipelineContext, _result): Promise<void> => {
      const hookContext: ToolHookContext = {
        toolName: ctx.tool.name,
        toolUseID: ctx.toolUseId,
        input: { ...ctx.input },
        permissionMode: 'auto' as never,
        abortSignal: undefined,
      };

      await hookManager.executePostToolUseHooks(hookContext, {});
    },
  };
}

// ── 批量注册辅助函数 ──────────────────────────────────────────────────

/**
 * 注册所有可选中间件
 * 在 ToolExecutor 初始化时调用一次
 */
export async function initializePipelineMiddleware(): Promise<void> {
  // 仅注册非内置的中间件（Security 已在 PipelineBuilder 中注册）
  registerMiddleware(MiddlewareGroup.PERMISSION, createPermissionMiddleware());
  registerMiddleware(MiddlewareGroup.PRE_HOOK, createPreHookMiddleware());
  registerMiddleware(MiddlewareGroup.POST_HOOK, createPostHookMiddleware());

  // GOVERNANCE、SANDBOX、VALIDATION、AUDIT 中间件不在此处注册：
  //   - GOVERNANCE + SANDBOX → 快速通道跳过，完整通道仍在 ToolExecutor 中处理
  //   - VALIDATION → 由 ToolExecutor.validateInput 处理
  //   - AUDIT → 由 GovernanceManager.auditService 处理
}
