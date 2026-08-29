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
 * 核心类型定义（2026-08-29 类型中心收缩）
 *
 * 仅保留有真实消费方的类型：
 *   - HooksSettings：唯一事实源 utils/settings/types.ts（3 个消费方：agentLoader/agent models/services agent）
 *   - SettingsJson：@deprecated 兼容 re-export（from config/types）
 *
 * 已删除 18 个零消费死类型（ToolContext/ToolResult/CommandContext/PermissionContext/
 * SessionManager/Session/ContentBlock/Message/Tool/AppConfig/Command/ModelSetting 等）：
 * 各模块使用自身领域类型（tools/types、chat/types、permission/ 等），
 * 会话消息事实规范为 chat/types/message.ts（@deprecated 迁 @modules/core/data-models 的 DataMessage）。
 */

/**
 * Webhook 钩子设置（唯一事实源：utils/settings/types.ts）
 */
export type { HooksSettings } from '../utils/settings/types.js';

/**
 * 命令（CLI 命令接口——commands/env、system/state/AppState 消费）
 */
export interface Command {
  name: string;
  description: string;
  aliases?: string[];
  execute(args: string[], context?: Record<string, unknown>): Promise<void>;
}

/**
 * 模型设置（system/state/AppState 消费）
 */
export interface ModelSetting {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * 用户设置（@deprecated 请从 @modules/config/types 导入 SettingsJson）
 */
export type { SettingsJson } from '../config/types.js';
