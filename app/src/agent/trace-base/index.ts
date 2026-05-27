/**
 * Agent Trace Base
 * 对标 OpenClaw agents/trace-base.ts
 * 代理追踪基础类型定义
 */

/**
 * 代理追踪基础信息
 */
export interface AgentTraceBase {
  /** 运行ID */
  runId?: string;
  /** 会话ID */
  sessionId?: string;
  /** 会话密钥 */
  sessionKey?: string;
  /** 提供商 */
  provider?: string;
  /** 模型ID */
  modelId?: string;
  /** 模型API地址 */
  modelApi?: string | null;
  /** 工作目录 */
  workspaceDir?: string;
}

/**
 * 构建代理追踪基础信息
 */
export function buildAgentTraceBase(params: AgentTraceBase): AgentTraceBase {
  return {
    runId: params.runId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    provider: params.provider,
    modelId: params.modelId,
    modelApi: params.modelApi,
    workspaceDir: params.workspaceDir,
  };
}
