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
 * 插件清单模式
 */
export const PluginManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  author: PluginAuthorSchema.optional(),
  keywords: z.array(z.string()).optional(),
  homepage: z.string().optional(),
  commands: z.array(z.string()).optional(),
  agents: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  hooks: z.string().optional(),
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
