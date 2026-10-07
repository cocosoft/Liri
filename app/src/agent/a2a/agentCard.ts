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
 * AgentDefinition → A2A AgentCard 映射（D3）
 *
 * 依据《A2A 协议技术手册》§5.1（卡片核心字段）与 §12.1（协议层自检清单）。
 * 纪律（§5.3）：卡片**不得内嵌静态密钥** —— 只声明 `securitySchemes`，凭证经 HTTP Header 带外传递。
 */

import { createHash } from 'node:crypto';
import type { AgentDefinition } from '../registry/AgentRegistry';
import { A2A_RPC_PATH } from './types';
import type { A2AAgentCard, A2AAgentSkill } from './types';

/** v1.0 协议版本（§11.1 / §12.4） */
export const A2A_PROTOCOL_VERSION = '1.0';

/** 默认内容模式：本项目当前只处理文本 */
const DEFAULT_INPUT_MODES = ['text/plain'];
const DEFAULT_OUTPUT_MODES = ['text/plain'];

export interface AgentCardOptions {
  /** A2A 端点 URL（由调用方按实际监听地址传入，**禁止**硬编码域名/端口） */
  baseUrl: string;
  /** 卡片版本（服务端给出，用于 ETag / 条件请求） */
  version: string;
  /** 发布方信息 */
  provider?: { organization: string; url?: string };
  /** Agent 名称（默认取项目名） */
  name?: string;
  description?: string;
}

/**
 * 单个 Agent 的能力 → AgentSkill（§5.1）
 *
 * 映射口径：`expertise`（专业领域）与 `capabilities`（能力标签）合并为 skills ——
 * 前者描述"会什么"，后者描述"能做什么"，对客户端发现都是可检索维度。
 */
function toSkill(definition: AgentDefinition): A2AAgentSkill {
  const tags = [...definition.expertise, ...(definition.capabilities ?? [])];
  const description =
    definition.systemPrompt?.trim() ||
    `${definition.name}（角色：${definition.role}）`;

  return {
    id: definition.agentId,
    name: definition.name,
    description,
    tags,
    inputModes: DEFAULT_INPUT_MODES,
    outputModes: DEFAULT_OUTPUT_MODES,
  };
}

/**
 * 由注册表内的 Agent 定义构建 Agent Card。
 *
 * `profile` 能力映射：Agent 定义中的 `model` 不回写到卡片 —— 模型名属实现细节
 * （且 model-usage 规则禁止在代码/契约中固化模型名），客户端应只据 skills 选择 Agent。
 */
export function buildAgentCard(
  definitions: AgentDefinition[],
  options: AgentCardOptions
): A2AAgentCard {
  const skills = definitions.map(toSkill);

  return {
    name: options.name ?? 'Liri Agent',
    description:
      options.description ??
      `Liri 本地 Agent 端点，当前发布 ${skills.length} 个 Agent。`,
    provider: options.provider ?? { organization: 'Liri' },
    version: options.version,
    // 能力声明**必须与实现一致**（§4.1/§4.2：未支持的能力须在卡片声明为 false）
    // R11-3 D1（2026-10-07）：补 stateTransitionHistory 并**如实**为 false
    //（只暴露任务当前态，不含状态变更历史）。
    // T4 批次 C（2026-10-07）：`streaming` 翻为 **true** —— SSE 流式（`SendStreamingMessage` /
    // `SubscribeToTask`）已实现（`a2a-routes.ts` 的 `openSseStream`），**如实**声明。
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: DEFAULT_INPUT_MODES,
    defaultOutputModes: DEFAULT_OUTPUT_MODES,
    skills,
    // T4 批次 D（2026-10-07）：按 **v1.0 形状**如实声明传输绑定 —— 顶层 `url` / `protocolVersion`
    // 已被 v1.0 移除（"Primary endpoint now in `supportedInterfaces[0].url`"），主端点＝本仓的
    // **JSON-RPC 单入口**（`A2A_RPC_PATH`，与路由共用同一常量 ⇒ 不漂移）。
    // 注：R11-3 D3 曾**撤销**该声明，理由是"当时未实现任何标准绑定"；**T4 批次 B/C 已实现**
    // JSON-RPC + SSE ⇒ 本批**如实恢复**（关闭预存 A2A-1）。
    supportedInterfaces: [
      {
        url: joinUrl(options.baseUrl, A2A_RPC_PATH),
        protocolBinding: 'JSONRPC',
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ],
    // 只声明方案，不内嵌任何凭证（§5.3）
    securitySchemes: {
      bearer: { type: 'http', scheme: 'bearer' },
    },
    securityRequirements: [{ bearer: [] }],
  };
}

/** 拼接基址与路径（去重尾部 `/`；**不**硬编码域名/端口） */
function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

/** 卡片 ETag：内容哈希（§5.4 条件请求用） */
export function computeAgentCardEtag(card: A2AAgentCard): string {
  const canonical = JSON.stringify(card);
  return `"${createHash('sha1').update(canonical).digest('hex')}"`;
}

/**
 * 卡片版本：由 **Agent 定义集合内容**派生（定义增删改 → 版本变化 → ETag 变化）。
 *
 * 刻意不取 app 版本号：卡片版本描述的是"这张名片描述的能力集"，
 * 与产品版本解耦（改一次 Agent 注册即应触发客户端重新拉取）。
 */
export function computeAgentCardVersion(
  definitions: AgentDefinition[]
): string {
  const canonical = JSON.stringify(
    definitions
      .map((d) => [
        d.agentId,
        d.name,
        d.role,
        d.expertise,
        d.capabilities ?? [],
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  );
  return createHash('sha1').update(canonical).digest('hex').slice(0, 12);
}
