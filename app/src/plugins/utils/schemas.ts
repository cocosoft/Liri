/**
 * 插件模式验证
 * 负责验证插件清单和配置的结构
 */

import { z } from 'zod';

/**
 * 插件作者模式
 */
export const PluginAuthorSchema = z.object({
  name: z.string(),
  email: z.string().optional(),
});

/**
 * 插件类型枚举
 */
export const PluginTypeEnum = z.enum([
  'tool',
  'theme',
  'language',
  'integration',
  'utility',
  'custom',
]);

/**
 * 技能参数模式
 */
export const PluginSkillParameterSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
  description: z.string(),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  enum: z.array(z.string()).optional(),
});

/**
 * 技能清单模式
 */
export const PluginSkillManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  parameters: z.array(PluginSkillParameterSchema).optional(),
  entryFunction: z.string().optional(),
});

/**
 * Hook 清单模式
 */
export const PluginHookManifestSchema = z.object({
  name: z.string(),
  phase: z.enum(['before', 'after', 'onError']),
  entryFunction: z.string(),
  priority: z.number().optional(),
});

/**
 * 插件清单模式
 */
export const PluginManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string(),
  type: PluginTypeEnum,
  main: z.string(),
  engine: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  optionalDependencies: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  homepage: z.string().optional(),
  license: z.string().optional(),
  icon: z.string().optional(),
  skills: z.array(PluginSkillManifestSchema).optional(),
  hooks: z.array(PluginHookManifestSchema).optional(),
  configSchema: z.record(z.unknown()).optional(),
  commands: z.array(z.string()).optional(),
  agents: z.array(z.string()).optional(),
  mcpServers: z.string().optional(),
  lspServers: z.string().optional(),
});

/**
 * 插件钩子配置模式
 */
export const PluginHooksSchema = z.object({
  description: z.string().optional(),
  hooks: z.array(z.any()),
});

/**
 * 插件标识符模式
 */
export const PluginIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9\-_]+(@[a-zA-Z0-9\-_]+)?$/);

export type PluginId = string;

/**
 * 插件市场条目模式
 */
export const PluginMarketplaceEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  author: z.string(),
  source: z.union([
    z.string(),
    z.object({
      source: z.literal('npm'),
      package: z.string(),
      version: z.string().optional(),
      registry: z.string().optional(),
    }),
    z.object({
      source: z.literal('github'),
      repo: z.string(),
      ref: z.string().optional(),
      sha: z.string().optional(),
    }),
    z.object({
      source: z.literal('url'),
      url: z.string(),
      ref: z.string().optional(),
      sha: z.string().optional(),
    }),
    z.object({
      source: z.literal('git-subdir'),
      url: z.string(),
      path: z.string(),
      ref: z.string().optional(),
      sha: z.string().optional(),
    }),
  ]),
  keywords: z.array(z.string()).optional(),
  homepage: z.string().optional(),
  icon: z.string().optional(),
});

/**
 * 命令元数据模式
 */
export const CommandMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  usage: z.string().optional(),
  examples: z.array(z.string()).optional(),
  arguments: z
    .record(
      z.object({
        description: z.string(),
        required: z.boolean().optional(),
        default: z.any().optional(),
      })
    )
    .optional(),
  options: z
    .record(
      z.object({
        description: z.string(),
        required: z.boolean().optional(),
        default: z.any().optional(),
        alias: z.string().optional(),
      })
    )
    .optional(),
});

export type PluginAuthor = z.infer<typeof PluginAuthorSchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type CommandMetadata = z.infer<typeof CommandMetadataSchema>;
export type PluginMarketplaceEntry = z.infer<
  typeof PluginMarketplaceEntrySchema
>;
export type PluginSkillManifest = z.infer<typeof PluginSkillManifestSchema>;
export type PluginHookManifest = z.infer<typeof PluginHookManifestSchema>;
export type PluginSkillParameter = z.infer<typeof PluginSkillParameterSchema>;
