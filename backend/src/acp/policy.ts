import type { AcpApprovalClass } from './types.js';

export interface AcpPolicyConfig {
  enabled: boolean;
  allowedAgents: string[];
  defaultApprovalClass: AcpApprovalClass;
  blockedTools: string[];
}

export function isAcpEnabledByPolicy(config: AcpPolicyConfig): boolean {
  return config.enabled;
}

export function isAcpAgentAllowedByPolicy(agentName: string, config: AcpPolicyConfig): boolean {
  if (!config.enabled) {
    return false;
  }
  if (config.allowedAgents.length === 0) {
    return true;
  }
  return config.allowedAgents.includes(agentName);
}

export type AcpDispatchPolicyState = 'allowed' | 'blocked' | 'needs_approval';

export function resolveAcpDispatchPolicyState(
  approvalClass: AcpApprovalClass,
  autoApprove: boolean
): AcpDispatchPolicyState {
  if (approvalClass === 'blocked') {
    return 'blocked';
  }
  if (approvalClass === 'always_allow' || approvalClass === 'auto_approve') {
    return 'allowed';
  }
  if (autoApprove) {
    return 'allowed';
  }
  return 'needs_approval';
}
