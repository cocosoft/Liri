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
 * Fast Mode
 * 对标 OpenClaw agents/fast-mode.ts
 * 快速模式状态解析系统
 * 优先级链: session → agent → config → default
 */

/**
 * 快速模式状态
 */
export interface FastModeState {
  /** 是否启用 */
  enabled: boolean;
  /** 来源层级 */
  source: 'session' | 'agent' | 'config' | 'default';
}

/**
 * 快速模式配置项
 */
export interface FastModeConfig {
  /** 会话级覆盖 */
  sessionOverride?: boolean | string | null;
  /** 代理级默认值 */
  agentDefault?: boolean;
  /** 模型级配置 */
  modelConfig?: {
    provider: string;
    model: string;
    fastMode?: boolean | string;
  };
}

/**
 * 规范化 fastMode 值
 * 支持 boolean、string 'true'/'false'、null/undefined
 */
export function normalizeFastMode(
  value: boolean | string | null | undefined
): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    if (lower === 'true') {
      return true;
    }
    if (lower === 'false') {
      return false;
    }
    return undefined;
  }
  return undefined;
}

/**
 * 解析快速模式状态
 * 优先级链: session → agent → config → default
 */
export function resolveFastModeState(config?: FastModeConfig): FastModeState {
  const sessionOverride = normalizeFastMode(config?.sessionOverride);
  if (sessionOverride !== undefined) {
    return { enabled: sessionOverride, source: 'session' };
  }

  if (typeof config?.agentDefault === 'boolean') {
    return { enabled: config.agentDefault, source: 'agent' };
  }

  const modelFastMode = normalizeFastMode(config?.modelConfig?.fastMode);
  if (modelFastMode !== undefined) {
    return { enabled: modelFastMode, source: 'config' };
  }

  return { enabled: false, source: 'default' };
}
