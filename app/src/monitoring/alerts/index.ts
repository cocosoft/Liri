/**
 * 告警模块导出
 */

export {
  AlertManager,
  AlertLevel,
  getAlertManager,
  createAlertManager,
} from './AlertManager.js';

export type {
  AlertManagerConfig,
  AlertRule,
  AlertNotification,
  AlertHandler,
  AlertSilence,
} from './AlertManager.js';

export { AlertPresetValidator } from './AlertSchema.js';

export type {
  PresetAlertLevel,
  PresetConditionType,
  AlertPresetCondition,
  AlertPresetChannel,
  AlertPresetRule,
  AlertPresetMetadata,
  AlertPresetFile,
  AlertPresetValidationResult,
  AlertPresetLoaderConfig,
  LoadedPresetRule,
} from './AlertSchema.js';

export {
  AlertPresetLoader,
  createAlertPresetLoader,
} from './AlertPresetLoader.js';

export type { AlertPresetLoadResult } from './AlertPresetLoader.js';
