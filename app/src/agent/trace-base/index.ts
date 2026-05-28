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
