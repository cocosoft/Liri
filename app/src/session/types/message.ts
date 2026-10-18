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
 * 消息模型（会话消息事实规范；C3 拆分后的 **barrel + 核心模型**，2026-10-09）
 *
 * R04-001 尺寸债治理：原单文件 1280 行，按**内聚**拆为：
 * - `./message/enums.ts`      —— 角色/类型/状态/优先级/附件类型/分类 + 消息别名
 * - `./message/blocks.ts`     —— 内容块 / 压缩边界 / 工具摘要 / 附件消息
 * - `./message/options.ts`    —— 收发选项（Send/Stream/Options）与创建参数
 * - `./message/factories.ts`  —— 工厂与工具函数（create / generate / normalize 系列）
 *
 * **本文件是对外唯一入口**（`@modules/session/types/message`）：核心类型由
 * `./message/core.ts` 定义（2026-10-19 断环下沉），本文件原样重导出 ⇒ **既有 import 零改动**。
 */

// ─── 子模块原样重导出（保持对外 API 不变）───
export * from './message/enums';
export * from './message/blocks';
export * from './message/options';
export * from './message/factories';

// 2026-10-19（CI 断环）：`Message` / `NormalizedMessage` / `UsageInfo` /
// `ToolCallEventDetail` 与三个角色别名下沉到叶子模块 `./message/core`。
// 子模块（enums/options/factories）只依赖该叶子 ⇒ `message.ts ↔ 子模块` 环消失。
export type {
  Message,
  NormalizedMessage,
  UsageInfo,
  ToolCallEventDetail,
  UserMessage,
  AssistantMessage,
  SystemMessage,
} from './message/core';
import type { Message } from './message/core';

/**
 * 聊天响应
 */
export interface ChatResponse {
  /**
   * 消息
   */
  message: Message;

  /**
   * 工具调用列表
   */
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;

  /**
   * token使用情况
   */
  usage?: {
    /**
     * 输入token数
     */
    inputTokens: number;

    /**
     * 输出token数
     */
    outputTokens: number;

    /**
     * 总token数
     */
    totalTokens: number;
  };

  /**
   * 模型名称
   */
  model?: string;

  /**
   * 完成原因
   */
  finishReason?: string;
}

/**
 * 流数据块
 */
export interface StreamChunk {
  /**
   * 内容
   */
  content: string;

  /**
   * 完成标志
   */
  isComplete: boolean;

  /**
   * token使用情况
   */
  usage?: {
    /**
     * 输入token数
     */
    inputTokens: number;

    /**
     * 输出token数
     */
    outputTokens: number;

    /**
     * 总token数
     */
    totalTokens: number;
  };

  /**
   * 模型名称
   */
  model?: string;

  /**
   * 完成原因
   */
  finishReason?: string;
}
