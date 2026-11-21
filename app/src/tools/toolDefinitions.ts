/**
 * 出站工具定义构造（OpenAI 兼容 `tools[]`）
 *
 * 2026-11-21：从 `toolNameCodec.ts` 拆出。原因：本函数需要按**功能开关**逐轮裁剪
 * （`isToolEnabledByGate`，运行时依赖），而 `toolNameCodec.ts` 是 A7 派生任务源
 * （`src-is-wire-safe-tool-name` / `src-to-wire-tool-name`）指向的**零运行时 import** 纯函数文件
 * ——在那里加运行时 import 会让规格资格线消失（`tests/evals/sourceTaskSpecs.test.ts` 守卫）。
 *
 * 命名转换本身仍归 `toolNameCodec`（单一事实源）；本文件只负责"投影 + 开关裁剪"。
 */

import type { ToolDefinition } from '@modules/ai';
// 2026-11-21：工具级功能开关（browser / computer_use）在出站定义处裁剪
import { isToolEnabledByGate } from '@openliri/tool-runtime';
import { toWireToolName } from './toolNameCodec';
import type { ToolSchemaLike } from './toolNameCodec';

/**
 * `ToolSchema`（本仓形状）→ OpenAI 兼容 `ToolDefinition`（**出站**用 wire 安全名）。
 *
 * 单一事实源（2026-10-08）：原实现只存在于 `ChatRequestPrep.buildToolDefinitions`
 * （会话路径专用），LRTO 步骤路径因此**无法**构造工具定义 —— 与"步骤无工具"缺陷同批修复。
 * 会话路径改为委托本函数（CS01：不重复实现）。
 */
export function buildToolDefinitions(
  schemas: readonly ToolSchemaLike[]
): ToolDefinition[] {
  // 2026-11-21：工具级功能开关在**每次构造出站定义时**求值（唯一裁剪点）——
  // 注册只发生一次，若在注册期裁剪则"打开开关需重启"；验收要求"下一轮即可见"。
  return schemas
    .filter((schema) => isToolEnabledByGate(schema.name))
    .map((schema) => ({
      type: 'function' as const,
      function: {
        // wire codec：出站必须用 wire 安全名。OpenAI 兼容 `tools[].function.name` 只接受
        // `^[a-zA-Z0-9_-]+$`（禁冒号）——原样下发冒号命名空间工具（`calendar:add` /
        // `office:workflow` / `mail:send`）会被 provider 以 400 拒绝
        // （`Invalid 'tools[N].function.name'…`）⇒ `chunkCount:0` ⇒ 走空回复兜底
        // ⇒ 用户感知「长程任务中断」。入站由 `ToolRegistry.resolveRegisteredName()` 回真名。
        name: toWireToolName(schema.name),
        description: schema.description ?? '',
        parameters: {
          type: 'object' as const,
          properties:
            (schema.input_schema as { properties?: unknown })?.properties || {},
          required:
            (schema.input_schema as { required?: string[] })?.required || [],
        },
      },
    }));
}
