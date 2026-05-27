/**
 * SDK setup — 插件创建和配置
 *
 * 包含插件创建、验证、版本管理和 Schema 验证等工具。
 * 插件开发者通过此层完成插件的定义和配置。
 */

// 插件验证
export { PluginValidator } from '../PluginValidator';
export type { PluginValidatorOptions } from '../PluginValidator';

// 简化插件创建
export { createPlugin } from '../../utils/createPlugin';
export type { PluginDefinition } from '../../utils/createPlugin';

// 版本管理
export {
  PluginVersionManager,
  calculatePluginVersion,
  pluginVersionManager,
} from '../../utils/pluginVersioning';
export type {
  VersionInfo,
  UpdateCheckResult,
  VersionCompareResult,
} from '../../utils/pluginVersioning';

// Schema 验证
export {
  PluginManifestSchema,
  PluginTypeEnum,
  PluginSkillManifestSchema,
  PluginHookManifestSchema,
  PluginSkillParameterSchema,
  PluginAuthorSchema,
  PluginHooksSchema,
  PluginIdSchema,
  PluginMarketplaceEntrySchema,
  CommandMetadataSchema,
} from '../../utils/schemas';
export type {
  PluginAuthor,
  PluginManifest as SchemaPluginManifest,
  CommandMetadata,
  PluginMarketplaceEntry,
  PluginSkillManifest as SchemaSkillManifest,
  PluginHookManifest as SchemaHookManifest,
  PluginSkillParameter as SchemaSkillParameter,
  PluginId,
} from '../../utils/schemas';
