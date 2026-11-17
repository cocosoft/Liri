// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 图像输入路径守卫（2026-11-17，T3 复杂度清理 stage 4）。
 *
 * 从 `ToolExecutionService._executeInternal` **原样搬出**「图像路径校验」整段：
 *  ① `inputPath` 缺省时从图像上下文（最近分析/生成/编辑）自动补全；
 *  ② 已知图像路径集合 = 会话内已知路径 + 项目沙箱目录扫描（深度 ≤3、上限 200、跳过 `_` 目录）；
 *  ③ 不在已知集合 ⇒ 先自动修正到最接近路径（告警）；无法修正 ⇒ 拒绝执行并回可读错误。
 *
 * 为什么独立成模块：`_executeInternal` 圈复杂度 108，本段约占四分之一；抽成注入依赖的
 * 逻辑后可直接单测（见 `app/tests/chat/imagePathGuard.test.ts`）。
 *
 * 契约：`result !== null` ⇒ 调用方**立即返回**（拒绝执行）；
 * `patchedArgs` 非空 ⇒ 调用方用它替换工具入参（`inputPath` 补全/修正）。
 */
import fs from 'fs';
import { join } from 'path';
import { getLogger } from '@openliri/infra/monitoring';
import { resolveDataDir } from '@openliri/infra/environment';
import type { ToolName } from '@openliri/infra/constants/toolNames.generated';
import type { ChatSession } from '@modules/session/types/session.js';
import type { ToolResult } from '@modules/session/types/tool.js';
import type { ImageContextService } from './ImageContextService.js';

const logger = getLogger('chat:toolExecution');

// 2026-09-29（P2-3 / T2）：真名由 `satisfies readonly ToolName[]` 编译期校验（拼错 ⇒ typecheck 报错）
const IMAGE_INPUT_TOOL_NAME_LIST = [
  'image_analysis',
  'image',
] as const satisfies readonly ToolName[];
const IMAGE_INPUT_TOOLS = new Set<string>(IMAGE_INPUT_TOOL_NAME_LIST);

/** 沙箱目录内视为「图像产物」的扩展名（扫描补全已知路径用） */
const SANDBOX_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.svg', '.webp'];

export interface ImagePathGuardDeps {
  imageContextService: Pick<
    ImageContextService,
    'getImageContext' | 'getKnownImagePaths' | 'findClosestPath'
  >;
  getSession(sessionId: string): ChatSession | undefined;
}

export interface ImagePathGuardParams {
  toolCall: { id: string; name: string; sessionId?: string };
  args: Record<string, unknown>;
  deps: ImagePathGuardDeps;
}

export interface ImagePathGuardOutcome {
  /** 非 `null` ⇒ 调用方立即返回（拒绝执行） */
  result: ToolResult | null;
  /** 非空 ⇒ 用其替换工具入参（`inputPath` 自动补全 / 修正） */
  patchedArgs?: Record<string, unknown>;
}

export async function guardImageInputPath(
  params: ImagePathGuardParams
): Promise<ImagePathGuardOutcome> {
  const { toolCall, args, deps } = params;

  if (!IMAGE_INPUT_TOOLS.has(toolCall.name) || !toolCall.sessionId) {
    return { result: null };
  }

  const sessionId = toolCall.sessionId;
  let inputPath = (args.inputPath || args.file_path || args.path) as
    | string
    | undefined;
  let patchedArgs: Record<string, unknown> | undefined;

  if (!inputPath && toolCall.name === 'canvas') {
    const elements = args.elements as Array<{ src?: string }> | undefined;
    if (Array.isArray(elements) && elements.length > 0 && elements[0].src) {
      inputPath = elements[0].src;
    }
  }

  if (!inputPath) {
    const ctx = deps.imageContextService.getImageContext(sessionId);
    if (ctx) {
      if (toolCall.name === 'image') {
        inputPath =
          ctx.lastEditedImage?.filePath ||
          ctx.lastGeneratedImage?.filePath ||
          ctx.lastAnalyzedImage?.filePath;
      } else {
        inputPath =
          ctx.lastAnalyzedImage?.filePath ||
          ctx.lastGeneratedImage?.filePath ||
          ctx.lastEditedImage?.filePath;
      }
      if (inputPath) {
        logger.info('工具调用 inputPath 为空，从 imageContext 自动补全', {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          sessionId,
          autoFilledPath: inputPath,
        });
        patchedArgs = { ...args, inputPath };
      }
    }
  }

  if (!inputPath) return { result: null, patchedArgs };

  let knownPaths = deps.imageContextService.getKnownImagePaths(sessionId);

  try {
    const session = deps.getSession(sessionId);
    const projectId = session?.metadata?.projectId as string | undefined;
    if (projectId) {
      const { createProjectStore } =
        await import('../../workspace/ProjectStore.js');
      const { WorkItemStore } =
        await import('../../workspace/WorkItemStore.js');
      const store = createProjectStore(
        resolveDataDir(),
        new WorkItemStore(resolveDataDir())
      );
      const project = store.get(projectId);
      if (project?.sandboxPath && fs.existsSync(project.sandboxPath)) {
        const collect = (dir: string, depth: number): string[] => {
          if (depth > 3) return [];
          let out: string[] = [];
          let entries: import('fs').Dirent[] = [];
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
          } catch {
            return out;
          }
          for (const e of entries) {
            if (out.length >= 200) break;
            const full = join(dir, e.name);
            if (e.isDirectory()) {
              if (e.name.startsWith('_')) continue;
              out = out.concat(collect(full, depth + 1));
            } else if (
              e.isFile() &&
              SANDBOX_IMAGE_EXTS.some((x) => e.name.toLowerCase().endsWith(x))
            ) {
              out.push(full);
            }
          }
          return out;
        };
        knownPaths = knownPaths.concat(collect(project.sandboxPath, 0));
      }
    }
  } catch {
    // @ignore-catch
  }

  if (knownPaths.length === 0 || knownPaths.includes(inputPath)) {
    return { result: null, patchedArgs };
  }

  const closestPath = deps.imageContextService.findClosestPath(
    inputPath,
    knownPaths
  );

  if (closestPath) {
    logger.warn('工具调用路径不匹配，自动修正为最接近的已知路径', {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      sessionId,
      inputPath,
      correctedPath: closestPath,
    });
    return { result: null, patchedArgs: { ...args, inputPath: closestPath } };
  }

  logger.error('工具调用路径不在已知集合中，拒绝执行', {
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    sessionId,
    inputPath,
    knownPaths,
  });
  return {
    result: {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: null,
      error: `Invalid path: ${inputPath} is not in known image paths. Available paths: ${knownPaths.join(', ')}`,
    },
  };
}
