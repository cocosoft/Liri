// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// ChatStream 工具调用两阶段的 chunk 产物（P3-2，2026-11-16）
//
// 原为 `CoreAPIImpl.chatStream` 内 `onToolCall` 闭包的两段内联分支（start / end，约 280 行），
// 使 CoreAPIImpl.ts 逼近单文件 2000 行上限（R04-001）⇒ 整段外移为独立模块。
// 判定、文案、日志与副作用顺序**逐字保留**；`this.*` 改为经 ctx 显式传入。

import * as fs from 'fs';
import { TOOL_NAME_CONSTANTS } from '@openliri/infra/constants';
import { handleError } from '@openliri/infra/error';
import { getLogger } from '@openliri/infra/monitoring';
import {
  TOOL_CALL_COMPLETED_STATUS,
  TOOL_CALL_FAILED_STATUS,
  TOOL_CALL_INITIAL_STATUS,
} from '@openliri/service/execution';
import { STATUS_TYPE } from '@shared/types';
import type { ChatManager } from '@modules/chat';
import type { SessionTitling } from '@openliri/service/runtime/api/sessionTitling';
import type { ToolCallEventDetail } from '@modules/session/types/message';
import type { ChatStreamChunk } from './CoreAPI';

const logger = getLogger('runtime:core-api');

/** 文件变更摘要（供上层聚合为 unified diff 卡片） */
export type PendingFileDiff = {
  file: string;
  diff: string;
  additions: number;
  deletions: number;
};

/** 两阶段共享的上下文：闭包外部状态 + 两处宿主能力 */
export type ToolCallStreamContext = {
  sessionId: string;
  pendingEvents: ChatStreamChunk[];
  pendingFileDiffs: PendingFileDiff[];
  /** tool:completed 事件携带的结果数据（按 toolCallId 暂存，完成时注入并出栈） */
  toolResultCache: Map<string, unknown>;
  /** 文件写入工具 start 时缓存的旧内容（end 计算 diff 后清理） */
  fileOldContentCache: Map<string, string>;
  sessionTitling: SessionTitling;
  chatManager: ChatManager;
  /** 由 chatStream 传入（D-227：app 层符号只在该方法内动态导入，禁止上提到模块顶层） */
  computeUnifiedDiff: (
    oldContent: string,
    newContent: string,
    filePath?: string
  ) => { diff: string; additions: number; deletions: number };
};

/**
 * 工具调用 start 阶段：缓存文件旧内容（供 end 计算 unified diff）+ 推送状态/工具卡片。
 */
export function emitToolCallStart(
  toolName: string,
  toolCallId: string,
  detail: ToolCallEventDetail | undefined,
  ctx: Pick<
    ToolCallStreamContext,
    'sessionId' | 'pendingEvents' | 'fileOldContentCache'
  >
): void {
  // detail 为结构化对象，直接取完整参数（不再截断字符串 JSON.parse）
  const toolArgs = detail?.args ?? {};
  const argsKeyCount = Object.keys(toolArgs).length;
  logger.debug('chatStream:onToolCall start', {
    sessionId: ctx.sessionId,
    toolName,
    toolCallId,
    argsKeyCount,
    argsEmpty: argsKeyCount === 0,
  });

  // E-1 diff（2026-08-23）：文件写入工具 start 时缓存旧内容（供 end 计算 unified diff）
  const fileWritingToolStart = [
    'file_write',
    'file_edit',
    'FileWrite',
    'FileEdit',
    'write',
    'create_file',
    'edit_file',
  ].includes(toolName);
  if (fileWritingToolStart) {
    const filePathArg =
      (toolArgs as { file_path?: unknown }).file_path ??
      (toolArgs as { filePath?: unknown }).filePath ??
      (toolArgs as { path?: unknown }).path;
    if (typeof filePathArg === 'string' && filePathArg) {
      try {
        if (fs.existsSync(filePathArg)) {
          ctx.fileOldContentCache.set(
            filePathArg,
            fs.readFileSync(filePathArg, 'utf-8')
          );
        }
      } catch {
        // 旧内容读取失败则不计算 diff（不影响工具执行）
      }
    }
  }

  ctx.pendingEvents.push({
    type: 'status',
    content: `🔧 Running tool: ${toolName}`,
    sessionId: ctx.sessionId,
    toolCallId,
    // L3（2026-08-23）：结构化 statusType（CS02）——前端 GroupStatusLine
    // 据此判断运行中，不再字符串匹配 "Running"
    statusType: STATUS_TYPE.TOOL_RUNNING,
  } as ChatStreamChunk);

  // 图像工具：流式返回进度状态（A-4：改用名称常量表；原 `image_analyze` 非注册名已订正）
  const imageStatus =
    toolName === TOOL_NAME_CONSTANTS.image_generate
      ? '🎨 AI is generating an image...'
      : toolName === TOOL_NAME_CONSTANTS.image_analysis ||
          toolName === TOOL_NAME_CONSTANTS.image
        ? '🔍 AI is analyzing the image...'
        : null;
  if (imageStatus) {
    ctx.pendingEvents.push({
      type: 'status',
      content: imageStatus,
      sessionId: ctx.sessionId,
      statusType: STATUS_TYPE.TOOL_RUNNING,
    } as ChatStreamChunk);
  }

  ctx.pendingEvents.push({
    type: 'tool_call',
    content: '',
    sessionId: ctx.sessionId,
    toolCall: {
      id: toolCallId,
      name: toolName,
      arguments: toolArgs,
      status: TOOL_CALL_INITIAL_STATUS,
    },
  } as ChatStreamChunk);
}

/**
 * 工具调用 end 阶段：失败/完成状态、写入路径提取（交付物登记 + unified diff 推送）、
 * tool:completed 结果注入与 create_project 导航元数据/会话关联。
 */
export function emitToolCallEnd(
  toolName: string,
  toolCallId: string,
  detail: ToolCallEventDetail | undefined,
  ctx: ToolCallStreamContext
): void {
  const { sessionId: finalSessionId, pendingEvents } = ctx;
  const isFailed = detail?.ok === false;
  const failMsg = detail?.message?.replace(/^失败:\s*/, '');
  logger.debug('chatStream:onToolCall end', {
    sessionId: finalSessionId,
    toolName,
    toolCallId,
    isFailed,
    failMsg,
    resultType: typeof detail?.result,
    resultLength:
      typeof detail?.result === 'string' ? detail.result.length : undefined,
  });
  pendingEvents.push({
    type: 'status',
    content: isFailed
      ? `❌ Tool ${toolName} failed${failMsg ? ` — ${failMsg}` : ''}`
      : `✅ Tool ${toolName} completed`,
    sessionId: finalSessionId,
    toolCallId,
    // L3（2026-08-23）：结构化 statusType（CS02）——前端据此判断完成/失败
    statusType: isFailed ? STATUS_TYPE.TOOL_FAILED : STATUS_TYPE.TOOL_COMPLETED,
  } as ChatStreamChunk);

  // 从工具执行结果中提取文件路径（file_write 等工具的 result 包含完整路径）
  // detail.result 为原始结果（字符串或对象），路径可能为 JSON 转义双斜杠
  let extractedArgs: Record<string, unknown> = {};
  const isFileWritingTool = [
    'file_write',
    'file_edit',
    'file_create',
    'write',
    'create_file',
    'edit_file',
  ].includes(toolName);
  if (isFileWritingTool && detail?.result != null && !isFailed) {
    let resultText = '';
    if (typeof detail.result === 'string') {
      resultText = detail.result;
    } else {
      try {
        resultText = JSON.stringify(detail.result) ?? '';
      } catch {
        // 循环引用等不可序列化结果，跳过路径提取
      }
    }
    const normalized = resultText.replace(/\\\\/g, '\\');
    const winPathMatch = normalized.match(
      /([A-Za-z]:\\(?:[^"\\]+\\)*[^"\\]+\.[a-zA-Z0-9]{1,10})/
    );
    if (winPathMatch) {
      extractedArgs = { file_path: winPathMatch[1] };
    }
    // E-1 接入（2026-08-23）：文件写入工具完成 → 记录交付物到 ExecutionPhaseTracker
    if (winPathMatch) {
      const tracker =
        ctx.sessionTitling.getExecutionPhaseTracker(finalSessionId);
      if (!tracker.getCurrentPhase()) {
        tracker.enter('implementing', '工具执行');
      }
      tracker.addArtifact({
        type: 'code',
        summary: `${toolName} 写入文件`,
        files: [winPathMatch[1]],
      });
    }
    // E-1 diff（2026-08-23）：文件变更前后 → unified diff（start 时已缓存旧内容）
    if (winPathMatch && ctx.fileOldContentCache.has(winPathMatch[1])) {
      try {
        const oldContent = ctx.fileOldContentCache.get(winPathMatch[1])!;
        const newContent = fs.readFileSync(winPathMatch[1], 'utf-8');
        const { diff, additions, deletions } = ctx.computeUnifiedDiff(
          oldContent,
          newContent,
          winPathMatch[1]
        );
        if (diff) {
          ctx.pendingFileDiffs.push({
            file: winPathMatch[1],
            diff,
            additions,
            deletions,
          });
        }
      } catch {
        // diff 计算失败不影响工具执行
      } finally {
        ctx.fileOldContentCache.delete(winPathMatch[1]);
      }
    }
    // 排查日志：打印 end 回调接收的完整 result 对象，确认文件路径提取正确
    logger.debug('chatStream:onToolCall end 路径提取', {
      sessionId: finalSessionId,
      toolName,
      toolCallId,
      isFailed,
      resultType: typeof detail.result,
      resultTextLength: resultText.length,
      resultText, // 完整 result（JSON 序列化文本），供核对路径来源
      normalizedLength: normalized.length,
      pathMatched: !!winPathMatch,
      extractedArgs,
    });
  }

  // 从缓存中查询 tool:completed 事件携带的结果数据并注入到完成块
  const cachedResult = ctx.toolResultCache.get(toolCallId);
  if (cachedResult) {
    ctx.toolResultCache.delete(toolCallId);
    logger.debug('chatStream:onToolCall end tool:completed 缓存命中', {
      sessionId: finalSessionId,
      toolName,
      toolCallId,
      cachedKeys: Object.keys(cachedResult).slice(0, 10),
    });
  }

  pendingEvents.push({
    type: 'tool_call',
    content: '',
    sessionId: finalSessionId,
    toolCall: {
      id: toolCallId,
      name: toolName,
      arguments: extractedArgs,
      status: isFailed ? TOOL_CALL_FAILED_STATUS : TOOL_CALL_COMPLETED_STATUS,
      // 将 tool:completed 事件的结果数据注入到完成块，确保前端能正确渲染
      result: cachedResult ? { success: true, data: cachedResult } : undefined,
    },
    // create_project 工具完成后注入导航建议元数据 + 关联 session
    _meta:
      toolName === TOOL_NAME_CONSTANTS.create_project && cachedResult
        ? (() => {
            // cachedResult 是 toolResult.data — 对于 create_project 是 JSON 字符串
            const rawData =
              typeof cachedResult === 'string'
                ? JSON.parse(cachedResult as unknown as string)
                : (cachedResult as Record<string, unknown>);
            return {
              action: 'suggest_navigate',
              target: `/projects?open=${rawData?.projectId}`,
              label: '查看项目',
            };
          })()
        : undefined,
  } as ChatStreamChunk);

  // create_project 工具完成后关联 session 到新项目
  if (
    toolName === TOOL_NAME_CONSTANTS.create_project &&
    cachedResult &&
    finalSessionId
  ) {
    try {
      const rawData =
        typeof cachedResult === 'string'
          ? JSON.parse(cachedResult as unknown as string)
          : (cachedResult as Record<string, unknown>);
      const projectId = rawData?.projectId as string | undefined;
      if (projectId) {
        const s = ctx.chatManager
          .getSessions()
          .find((s) => s.id === finalSessionId);
        if (s && !s.metadata?.projectId) {
          if (!s.metadata) {
            (s as unknown as Record<string, unknown>).metadata = {};
          }
          s.metadata.projectId = projectId;
          // P0-D: 持久化 projectId，防止重启后丢失
          void ctx.chatManager.persistSessionMetadata(s).catch((e: unknown) =>
            handleError(e, {
              module: 'runtime:core-api',
              action: 'persistSessionMetadata_afterCreateProject',
            })
          );
        }
      }
    } catch {
      /* 关联失败不影响主流程 */
    }
  }
}
