/**
 * 功能开关类型定义
 */

export type FeatureName =
  | 'COORDINATOR_MODE'
  | 'KAIROS'
  | 'PROACTIVE'
  | 'TEAMMEM'
  | 'BRIDGE_MODE'
  | 'DAEMON'
  | 'VOICE_MODE'
  | 'SANDBOX'
  | 'MCP_OAUTH'
  | 'COMMAND_PIPELINE';

export interface FeatureConfig {
  name: FeatureName;
  description: string;
  defaultValue: boolean;
  envVar: string;
}
