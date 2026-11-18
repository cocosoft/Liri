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
import { SessionGateway } from '../SessionGateway';
import { CombinedSessionGateway } from './CombinedSessionGateway';
import type {
  AgentGatewayEntry,
  CombinedGatewayConfig,
  CombinedSessionResult,
} from './CombinedSessionGateway';

export { CombinedSessionGateway };
export type {
  AgentGatewayEntry,
  CombinedGatewayConfig,
  CombinedSessionResult,
} from './CombinedSessionGateway';

/**
 * 创建 CombinedSessionGateway 实例，并自动注册所有传入的 Agent 网关
 *
 * @param gateways - Agent 会话网关映射
 * @param config - 组合网关配置
 * @returns 配置完成的 CombinedSessionGateway 实例
 */
export function createCombinedGateway(
  gateways?: Map<string, SessionGateway>,
  config?: CombinedGatewayConfig
): CombinedSessionGateway {
  const combined = new CombinedSessionGateway({
    ...config,
    autoInitialize: config?.autoInitialize ?? true,
  });

  if (gateways) {
    for (const [agentId, gateway] of gateways) {
      combined.registerAgent(agentId, gateway);
    }
  }

  return combined;
}
