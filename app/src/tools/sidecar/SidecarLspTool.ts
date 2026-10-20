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
 * `lsp` 工具的**侧车适配器**（S2/T2.2 loader 侧车分支）。
 *
 * 方案：`.trae/specs/tool-sidecar-isolation.md` §3-D4（双跑开关）+ §6.1（双跑一致性）。
 *
 * 契约（**工具面对外不变**）：`name='lsp'`、`params`/`action` 语义、`maxResultSizeChars=10000`
 * 与内置 `LSPToolAdapter` **逐字一致**（由测试断言锁定，防漂移）。差异仅在**执行路径**：
 * 内置在**主进程**每次 `spawn`；本适配器把调用翻译为 **sidecar `request`** 并经 IPC 回传结果。
 *
 * 失败语义（**硬要求**，spec §2 反目标「静默双轨」）：开关开时**任何**侧车不可用 / 握手失败 /
 * 方法未实现 ⇒ **fail-closed 报错**（明确 error），**绝不**静默回落内置"每次 spawn"路径（CS03）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  Tool,
  ToolInfo,
  ToolParam,
  ValidationResult,
  InterruptBehavior,
} from '../types/Tool';
import type { ToolUseContext } from '../types/ToolUseContext';
import type { ToolResult } from '../types/ToolResult';
import { ToolTag } from '../types/Tool';
import { maybeStartLspSidecar } from './toolSidecarLifecycle';

/**
 * Landlock 适用性 —— **显式 N/A 声明**（spec `.trae/specs/tool-sidecar-isolation.md` §3-D6）。
 *
 * D6 要求：Landlock「按工具适用性**显式声明**，**不装作同源**」（CS06）。内核级文件系统沙箱
 * （Landlock）**仅**对"spawn 用户代码 / 命令"的工具适用（如 `code_run` 的 `LinuxSandboxRunner`、
 * bash 的 `bashLandlockExec`）；`lsp` 工具是**只读的代码智能查询**（不执行用户代码、不写目标文件）
 * ⇒ **Landlock 不适用（N/A）**。本常量为该结论的**代码级事实源**（由
 * `tests/tools/sidecar/sidecarSameSourceGate.test.ts` 断言锁定）。
 */
export const SIDECAR_LSP_LANDLOCK_APPLICABILITY = {
  applies: false,
  reason:
    'LSP 工具为只读代码智能查询（不 spawn 用户代码/命令、不写目标文件）⇒ Landlock（内核级文件系统沙箱）不适用',
} as const;

/** 侧车请求端口（窄签名：适配器所需 `request`；`ToolSidecarSupervisor` 天然满足） */
export interface LspSidecarRequester {
  request(
    method: string,
    params?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>>;
}

/** 侧车监督器提供者（缺省 {@link maybeStartLspSidecar}；测试可注入替身） */
export type LspSupervisorProvider = () => Promise<LspSidecarRequester | null>;

/** `lsp` 工具的侧车实现（开关 `TOOL_SIDECAR_LSP` 打开时由 loader 选中） */
export class SidecarLspTool implements Tool {
  name = 'lsp';

  description =
    'Language Server Protocol 工具，提供代码智能提示/定义跳转/引用/诊断/格式化/重命名等能力。' +
    '当目标文件在磁盘上时（绝大多数情况），必须优先使用 file_path 而非 document —— ' +
    '避免模型背诵数千行源码导致 output token 爆炸、JSON 截断与上下文溢出。';

  /**
   * ⚠️ 与 `tools/adapters/LSPToolAdapter.ts` 的 `params` **逐字一致**（形状契约）；
   * 由 `sidecarLspTool.test.ts` 的 schema 对照测试锁定。
   */
  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      description:
        '操作类型：completions, definition, references, diagnostics, format, hover, rename, codeAction, implementation, typeDefinition',
      required: true,
      enum: [
        'completions',
        'definition',
        'references',
        'diagnostics',
        'format',
        'hover',
        'rename',
        'codeAction',
        'implementation',
        'typeDefinition',
        'workspaceSymbol',
        'documentSymbol',
        'callHierarchy',
        'symbolContext',
      ],
      example: 'completions',
    },
    {
      name: 'file_path',
      type: 'string',
      description:
        '本地源代码文件路径（强烈推荐）。工具直接从磁盘读取文件内容 —— 0 输出 token，' +
        '不截断，不占上下文窗口。大多数场景必须使用此项。',
      required: false,
      example: 'app/src/tools/DocGenerateTool/DocGenerateTool.ts',
    },
    {
      name: 'document',
      type: 'string',
      description:
        '源代码内容本身。仅用于 snippet 级别的小代码段（file_path 不存在时才使用此项）。' +
        '严禁为磁盘上已有文件背诵全文到此处 — 会导致 token 爆炸。',
      required: false,
      example: 'function hello() { console.log("Hello"); }',
    },
    {
      name: 'language',
      type: 'string',
      description: '编程语言',
      required: true,
      enum: [
        'typescript',
        'javascript',
        'python',
        'java',
        'csharp',
        'cpp',
        'go',
        'rust',
      ],
      example: 'typescript',
    },
    {
      name: 'position',
      type: 'object',
      description: '光标位置 {line, character}',
      required: false,
      example: { line: 0, character: 10 },
    },
    {
      name: 'newName',
      type: 'string',
      description: '新名称（用于rename操作）',
      required: false,
      example: 'newFunctionName',
    },
  ];

  aliases = ['language-server', 'code-intelligence'];
  searchHint = '代码智能提示和分析';
  searchTips = [
    'code completion',
    'definition',
    'references',
    'diagnostics',
    'format',
  ];
  enabled = true;
  readOnly = false;
  destructive = false;
  concurrencySafe = true;
  deferred = false;
  alwaysLoad = false;
  maxResultSizeChars = 10000;

  private readonly provideSupervisor: LspSupervisorProvider;

  constructor(provideSupervisor: LspSupervisorProvider = maybeStartLspSidecar) {
    this.provideSupervisor = provideSupervisor;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  isConcurrencySafe(): boolean {
    return this.concurrencySafe;
  }

  interruptBehavior(): InterruptBehavior {
    return 'block';
  }

  /** 与内置 `LSPToolAdapter.validateParams` 同口径 */
  validateParams(params: Record<string, unknown>): ValidationResult {
    if (!params.action) {
      return { result: false, message: 'Missing required parameter: action' };
    }
    const hasDoc =
      typeof params.document === 'string' && params.document.trim().length > 0;
    const hasFile =
      typeof params.file_path === 'string' &&
      params.file_path.trim().length > 0;
    if (!hasDoc && !hasFile) {
      return {
        result: false,
        message:
          'Missing required parameter: file_path (preferred for files on disk) or document (for small snippets only). Do NOT recite full source code into document — causes output token explosion.',
      };
    }
    if (!params.language) {
      return { result: false, message: 'Missing required parameter: language' };
    }
    const positionActions = [
      'completions',
      'definition',
      'references',
      'hover',
      'implementation',
      'typeDefinition',
      'callHierarchy',
    ];
    if (positionActions.includes(params.action as string) && !params.position) {
      return {
        result: false,
        message: 'Missing required parameter: position for this action',
      };
    }
    if (params.action === 'rename' && !params.newName) {
      return {
        result: false,
        message: 'Missing required parameter: newName for rename action',
      };
    }
    return { result: true };
  }

  async execute(
    params: Record<string, unknown>,
    context: ToolUseContext
  ): Promise<ToolResult> {
    // S3/T3.2：认领工具上下文的取消信号（对齐 `McpToolWrapper` 的 `context.abortController.signal`）
    const signal = context?.abortController?.signal;
    try {
      const supervisor = await this.provideSupervisor();
      if (!supervisor) {
        return {
          success: false,
          error:
            'LSP 侧车不可用（未启动/握手失败）；已 fail-closed，不回落内置实现。',
          output: 'LSP sidecar unavailable',
        };
      }
      const action = String(params.action ?? '');
      const { document, uri } = readDocument(params);
      const frame = await supervisor.request(
        `lsp.${action}`,
        {
          language: String(params.language ?? ''),
          document,
          position: params.position,
          newName: params.newName,
          uri,
        },
        signal
      );
      return {
        success: true,
        data: frame.result,
        output: `LSP ${action} completed successfully`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 取消语义（≠ 失败重试，≠ 回落内置）：本地结算的明确错误
      const canceled = signal?.aborted === true;
      return {
        success: false,
        error: canceled ? `LSP 工具调用已取消：${message}` : message,
        output: canceled
          ? `LSP tool canceled: ${message}`
          : `LSP tool failed: ${message}`,
      };
    }
  }

  getInfo(): ToolInfo {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      aliases: this.aliases,
      searchTips: this.searchTips,
      searchHint: this.searchHint,
      enabled: this.enabled,
      readOnly: this.readOnly,
      destructive: this.destructive,
      concurrencySafe: this.concurrencySafe,
      // U-03（2026-10-19）：显式效果声明 —— 与内置 `lsp` 同源语义（rename/format 改本地文件）
      // ⇒ 非幂等、副作用限本机
      idempotent: false,
      sideEffect: 'local',
      deferred: this.deferred,
      alwaysLoad: this.alwaysLoad,
      interruptBehavior: this.interruptBehavior(),
      maxResultSizeChars: this.maxResultSizeChars,
      tags: [ToolTag.CODE],
    };
  }

  userFacingName(input?: Partial<Record<string, unknown>>): string {
    const action = (input?.action as string) || '';
    const language = (input?.language as string) || '';
    if (action && language) {
      return `LSP: ${action} (${language})`;
    }
    return this.name;
  }
}

/**
 * 归一化文档来源：`file_path`（推荐，主进程读盘、0 输出 token）优先，否则用小 snippet `document`。
 * 与内置 `LSPToolAdapter.execute` 的同名逻辑同口径（缺失文件 ⇒ 抛错，由 `execute` 转 fail-closed）。
 */
function readDocument(params: Record<string, unknown>): {
  document: string;
  uri?: string;
} {
  const filePath =
    typeof params.file_path === 'string' ? params.file_path.trim() : '';
  if (filePath) {
    const abs = resolve(filePath);
    if (!existsSync(abs)) {
      throw new Error(`file_path 指向的文件不存在：${abs}`);
    }
    return { document: readFileSync(abs, 'utf-8'), uri: `file://${abs}` };
  }
  return {
    document: typeof params.document === 'string' ? params.document : '',
  };
}
