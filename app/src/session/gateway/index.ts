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
