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

import type { Tool, ToolCallProgress } from '../types/Tool';
import type { AgentToolProgress } from '../types/ToolProgress';
import type { ToolUseContext } from '../types/ToolUseContext';
import type { AgentInput } from './types';
import {
  ALWAYS_BLOCKED_TOOLS,
  DELEGATE_BLOCKED_TOOLS,
  validateToolsetRequest,
} from './AgentToolsetContract';
import { toWireToolName } from '../toolNameCodec';
import { isValidMcpName } from '../../services/mcp/normalization';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('tools:agentTool');

/**
 * `AgentToolPool` 的宿主依赖（全部 getter/闭包：宿主状态在 run 期内可变）。
 *
 * 被迁出成员引用的宿主**模块级符号**一律经此注入（而非从 `AgentTool.ts` import），
 * 避免形成 `AgentTool.ts ↔ agentToolPool.ts` 循环 import。
 */
export interface AgentToolPoolDeps {
  /** 宿主模块级 `getAllTools`（DI getter 未注入时回退唯一注册表） */
  getAllTools: () => Tool[];
  /** 宿主模块级 `MAX_SUBAGENT_DEPTH`（子代理最大嵌套深度） */
  getMaxSubagentDepth: () => number;
  /** 宿主模块级 `filterToolPool`（O7：定义侧与执行侧的单一过滤源） */
  filterToolPool: (
    allowedTools: string[] | undefined,
    deniedTools: string[] | undefined,
    toolPool: Tool[]
  ) => Tool[];
}

/**
 * 子代理工具池 / 授权 / 工具定义 + 进度发射（C3 + C4）。
 *
 * 2026-10-05 纯搬迁自 `tools/AgentTool/AgentTool.ts`（文件规模债拆分 B1，见
 * `.trae/specs/file-size-debt-partition-plan.md` §28.5）——方法体、注释、日志文案、日志
 * module 名逐字保留，仅将宿主**模块级符号**改为经 `AgentToolPoolDeps` 注入。
 *
 * 可见性说明：`emit*` 与 `buildToolDefinitions` 等原为 `private`，外迁后宿主执行主链
 * 直调 `this.agentToolPool.X(...)` ⇒ 改为 `public`（签名与实现逐字不变）。
 */
export class AgentToolPool {
  constructor(private readonly deps: AgentToolPoolDeps) {}

  /**
   * 工具集入口（O5 seam `executeToolsets` + **O7 契约**）：归一 + **两段校验**。
   *
   * 契约（O7④）：
   * `子代理可用工具 = 父级可继承工具（父级全量 − DELEGATE_BLOCKED_TOOLS）`
   * `∩ allowedTools（若有） − deniedTools` —— 模型**只能收窄，不能扩权**。
   *
   * 校验在**登记台账之前**执行（`executeGuard` 内），失败即拒绝，不产生任何运行态副作用。
   *
   * @returns 拒绝原因；通过时返回 `null`（并把归一后的清单回写 `agentInput`）
   */
  executeToolsets(agentInput: AgentInput): string | null {
    // 归一：仅当传入**字符串**时按逗号切分去空白（非字符串不在此处改动）
    if (typeof agentInput.allowedTools === 'string') {
      agentInput.allowedTools = (agentInput.allowedTools as string)
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
    if (typeof agentInput.deniedTools === 'string') {
      agentInput.deniedTools = (agentInput.deniedTools as string)
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
    }

    const allowed = this.toToolNameList(agentInput.allowedTools);
    const denied = this.toToolNameList(agentInput.deniedTools);
    if (allowed === 'invalid' || denied === 'invalid') {
      return 'allowedTools / deniedTools 必须是字符串或字符串数组。';
    }

    const result = validateToolsetRequest({
      allowedTools: allowed,
      deniedTools: denied,
      // F3（2026-09-21）：父级工具池改为**与实际继承同源**（`getInheritableToolPool()`）。
      // 修复前传 `getAllTools()` 全量：它包含 N-42 判定为非法名的工具
      //（如 `media:image:*`，provider 命名约束 `^[a-zA-Z0-9_-]+$` 之外的冒号形式），
      // 而 worker 实际拿到的池经 `getInheritableToolPool()` 过滤 ⇒ 校验说"父级有、可授予"，
      // 执行侧池里却没有（"校验通过但工具缺失"）。同源后第①段即拒绝这类名字。
      contract: {
        parentToolNames: this.getInheritableToolPool().map((t) => t.name),
      },
    });
    if (!result.ok) {
      return result.error;
    }

    // 校验通过 ⇒ 以归一值回写，保证与 `buildToolDefinitions` 的口径一致
    if (allowed !== undefined) {
      agentInput.allowedTools = allowed;
    }
    if (denied !== undefined) {
      agentInput.deniedTools = denied;
    }
    return null;
  }

  /** 工具名清单归一（`undefined` 表示"未提供"；类型非法返回 `'invalid'`） */
  toToolNameList(value: unknown): string[] | undefined | 'invalid' {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (Array.isArray(value)) {
      if (!value.every((v) => typeof v === 'string')) {
        return 'invalid';
      }
      return value as string[];
    }
    return 'invalid';
  }

  /**
   * 子代理**可继承**工具池（O7①）：父级全量 − `DELEGATE_BLOCKED_TOOLS`（单一入口）。
   *
   * 修复前只有 `runWithEngine` 内联排除了 `agent`/`Task`，而 `runDirectCall` 传的是
   * **全量池**（含 `agent`/`Task`/`sessions_yield`）—— 同一契约两处实现、且其中一处漏排除。
   */
  getInheritableToolPool(options: { allowDelegation?: boolean } = {}): Tool[] {
    // T9：被授权的角色不再剔除**委派入口**（`agent`/`Task`）；`sessions_yield` 等
    // `ALWAYS_BLOCKED_TOOLS` 与授权无关，**始终**剔除（yield 属会话级语义）
    const blockedNames = options.allowDelegation
      ? ALWAYS_BLOCKED_TOOLS
      : DELEGATE_BLOCKED_TOOLS;
    const blocked = new Set(blockedNames.map((n) => n.toLowerCase()));
    // N-42（2026-09-21 真机实证）：工具名必须满足 provider 的命名约束
    // （OpenAI 兼容 `^[a-zA-Z0-9_-]+$`）—— 否则**整个 tools 数组被上游 400 拒绝**，
    // 子代理连一个工具都用不上（实证 `Invalid 'tools[60].function.name'`，来源是
    // media 模块的 `media:image:*` 等 15 个含冒号的工具名）。
    // 与 O7 同源约束：**定义侧与执行侧共用此池**（`buildToolDefinitions` 与
    // `toolInstances` 均取自本方法）⇒ 此处剔除即两侧同时生效，不会出现
    // "定义侧过滤、执行侧放行"的错配。
    const all = this.deps.getAllTools();
    const illegal = all.filter((t) => !isValidMcpName(t.name));
    if (illegal.length > 0) {
      logger.warn(
        'AgentTool 工具池剔除名称不合法的工具（避免整个 tools 被上游拒绝）',
        {
          dropped: illegal.length,
          sample: illegal.slice(0, 5).map((t) => t.name),
        }
      );
    }
    return all.filter(
      (t) => !blocked.has(t.name.toLowerCase()) && isValidMcpName(t.name)
    );
  }

  /**
   * T9：**能否再委派**的双判据合取 —— 角色策略（用户配置）× 父侧深度上限。
   *
   * - 角色策略：`canDelegate`（缺省 `false` ⇒ fail-closed）；
   * - 深度：判据与 `executeGuard` 同源（`context.subagentDepth < MAX_SUBAGENT_DEPTH`），
   *   避免出现"工具可见、但一调用就被深度守卫拒绝"的错配。
   *
   * **模型不能自选**：策略位来自 DB 角色（用户设定），模型只能在 `subagent_type` 里
   * 选择"用户已授权的角色"，无法把授权授予自己（即提权）。
   */
  resolveDelegationGrant(
    canDelegate: boolean | undefined,
    context?: ToolUseContext
  ): boolean {
    if (canDelegate !== true) return false;
    const depth = context?.subagentDepth ?? 0;
    return depth < this.deps.getMaxSubagentDepth();
  }

  /**
   * 进度发射（O5 seam `executeProgress`）：三处内联 `onProgress?.({…})` 的 payload
   * 形状收敛于此（单一来源），字段与原地实现逐条一致。
   */
  emitStart(
    onProgress: ToolCallProgress<AgentToolProgress> | undefined,
    agentId: string,
    agentName: string
  ): void {
    onProgress?.({
      toolUseID: agentId,
      data: {
        type: 'agent_tool',
        agentName,
        action: 'start',
        message: `Starting agent: ${agentName}`,
        isRunning: true,
        isComplete: false,
      },
    });
  }

  emitComplete(
    onProgress: ToolCallProgress<AgentToolProgress> | undefined,
    agentId: string,
    agentName: string,
    message: string
  ): void {
    onProgress?.({
      toolUseID: agentId,
      data: {
        type: 'agent_tool',
        agentName,
        action: 'complete',
        message,
        isRunning: false,
        isComplete: true,
      },
    });
  }

  emitError(
    onProgress: ToolCallProgress<AgentToolProgress> | undefined,
    agentId: string,
    agentName: string,
    message: string
  ): void {
    onProgress?.({
      toolUseID: agentId,
      data: {
        type: 'agent_tool',
        agentName,
        action: 'error',
        message,
        isRunning: false,
        isComplete: true,
      },
    });
  }

  /**
   * 按 `allowedTools` / `deniedTools` 过滤工具池（O7：**定义侧与执行侧的单一过滤源**）。
   *
   * 白名单先于黑名单（与原实现一致）；比较**大小写不敏感**。
   * 逻辑已抽为模块级纯函数 `filterToolPool`（便于守卫测试），此处仅委托 —— 行为不变。
   */
  filterToolPool(
    allowedTools: string[] | undefined,
    deniedTools: string[] | undefined,
    toolPool: Tool[]
  ): Tool[] {
    return this.deps.filterToolPool(allowedTools, deniedTools, toolPool);
  }

  /**
   * 构建工具定义列表（支持 allowedTools/deniedTools 过滤）
   *
   * **O7 契约（两段校验由 `executeToolsets` 在登记前完成，此处只做过滤）**：
   * `子代理可用工具 = 父级可继承工具（父级全量 − DELEGATE_BLOCKED_TOOLS）`
   * `∩ allowedTools（若有） − deniedTools`；模型**只能收窄，不能扩权**。
   *
   * @param toolPool 工具池（**默认即可继承池**，已排除 `agent`/`Task`/`sessions_yield`；
   *                 调用方仅在需要更窄的池时才显式传入）
   */
  buildToolDefinitions(
    allowedTools?: string[],
    deniedTools?: string[],
    toolPool?: Tool[]
  ): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> {
    const tools = this.filterToolPool(
      allowedTools,
      deniedTools,
      toolPool ?? this.getInheritableToolPool()
    );

    return tools.map((tool) => {
      const info = tool.getInfo();
      return {
        // wire codec：出站用 wire 安全名（禁冒号，否则 provider 400 ⇒ 整轮失败）
        name: toWireToolName(tool.name),
        description: info.description,
        parameters: {
          type: 'object' as const,
          properties: info.params.reduce(
            (acc, param) => {
              acc[param.name] = {
                type: param.type,
                description: param.description,
              };
              if (param.default !== undefined) {
                (acc[param.name] as any).default = param.default;
              }
              return acc;
            },
            {} as Record<string, unknown>
          ),
          required: info.params
            .filter((param) => param.required)
            .map((param) => param.name),
        },
      };
    });
  }
}
