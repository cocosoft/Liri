/**
 * 配置模块导出
 * @deprecated 请直接使用 @modules/config 中的导出。
 * 此处仅保留向后兼容。
 */

export {
  ConfigManager,
  type GlobalConfig,
  type ConfigSource as SourceType,
} from '@modules/config';

export type { ConfigLayer, ConfigChangeEvent } from './ConfigManager';
