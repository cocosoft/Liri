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
