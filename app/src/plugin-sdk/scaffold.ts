/**
 * plugin-sdk/scaffold.ts - 插件项目脚手架生成器（报告 4.5）
 *
 * 生成第三方插件项目模板：package.json（pyapp 字段，含 inject 声明）+ 入口文件 + README。
 * 生成的 package.json 会经过 validatePluginManifest 契约自检。
 * 保持 SDK 隔离边界：仅引用 ./types 与 ./core，不引用任何核心模块。
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import type { PluginManifest } from './types';
import { validatePluginManifest } from './core';

/** 脚手架选项 */
export interface PluginScaffoldOptions {
  /** 插件 ID（小写字母/数字/连字符/下划线） */
  id: string;
  /** 插件名称 */
  name: string;
  /** 插件版本（默认 0.1.0） */
  version?: string;
  /** 插件描述 */
  description?: string;
  /** 插件作者 */
  author?: string;
  /** 插件分类（tool/command/service/ui/other 等） */
  category?: string;
  /** 插件类型 */
  type?: string;
  /** 声明式服务注入（必需） */
  inject?: string[];
  /** 声明式服务注入（可选） */
  injectOptional?: string[];
  /** 插件名依赖 */
  dependencies?: string[];
}

/** 生成的模板文件 */
export interface ScaffoldFile {
  /** 相对路径（相对插件根目录） */
  path: string;
  content: string;
}

/** 默认入口文件内容（含声明式服务注入示例） */
function renderEntryFile(options: PluginScaffoldOptions): string {
  const injectComment =
    options.inject && options.inject.length > 0
      ? options.inject.map((s) => `  // 注入内核服务: ${s}`).join('\n')
      : '  // 未声明服务注入，如需注入内核服务可在此添加';

  return `// ${options.name} — 插件入口
import { createPlugin } from '@modules/plugin-sdk';

export default createPlugin({
  id: '${options.id}',
  name: '${options.name}',
  version: '${options.version ?? '0.1.0'}',
  description: '${options.description ?? ''}',
  author: '${options.author ?? ''}',
  category: '${options.category ?? 'tool'}',
${injectComment}
  inject: ${JSON.stringify(options.inject ?? [])},
  injectOptional: ${JSON.stringify(options.injectOptional ?? [])},

  initialize: async (context) => {
    context.log.info('${options.name} initialized');
    // 通过 context.services 访问注入的内核服务：
    // const configManager = context.services?.get('kernel.configManager');
  },

  activate: async (context) => {
    context.log.info('${options.name} activated');
  },

  deactivate: async (context) => {
    context.log.info('${options.name} deactivated');
  },

  destroy: async (context) => {
    context.log.info('${options.name} destroyed');
  },
});
`;
}

/** 渲染 package.json（pyapp 字段承载插件清单） */
function renderPackageJson(options: PluginScaffoldOptions): string {
  const manifest: PluginManifest = {
    id: options.id,
    name: options.name,
    version: options.version ?? '0.1.0',
    description: options.description ?? '',
    author: options.author ?? '',
    type: options.type ?? 'tool',
    main: 'index.js',
    inject: options.inject,
    injectOptional: options.injectOptional,
    dependencies: options.dependencies,
  };

  const packageJson = {
    name: options.name,
    version: options.version ?? '0.1.0',
    description: options.description ?? '',
    type: 'module',
    main: 'index.js',
    pyapp: manifest,
  };

  return `${JSON.stringify(packageJson, null, 2)}\n`;
}

/** 渲染 README */
function renderReadme(options: PluginScaffoldOptions): string {
  const injectSection =
    options.inject && options.inject.length > 0
      ? `## 声明的服务注入\n\n- 必需: ${options.inject.join(', ')}\n` +
        (options.injectOptional && options.injectOptional.length > 0
          ? `- 可选: ${options.injectOptional.join(', ')}\n`
          : '')
      : '';
  return `# ${options.name}

${options.description ?? ''}

## 清单（package.json "pyapp" 字段）

- ID: \`${options.id}\`
- 版本: ${options.version ?? '0.1.0'}
- 类型: ${options.type ?? 'tool'}
- 入口: index.js

${injectSection}
## 开发

1. 编辑 \`index.js\` 实现插件逻辑
2. 通过 \`context.services\` 访问注入的内核服务
3. 在 \`inject\` / \`injectOptional\` 中声明依赖的服务
`;
}

/**
 * 生成插件项目模板文件列表
 * @param options 脚手架选项
 * @returns 模板文件列表（path 为相对插件根目录）
 */
export function generatePluginTemplate(
  options: PluginScaffoldOptions
): ScaffoldFile[] {
  // 契约自检：生成的清单必须通过 validatePluginManifest
  const manifest: PluginManifest = {
    id: options.id,
    name: options.name,
    version: options.version ?? '0.1.0',
    description: options.description ?? '',
    author: options.author ?? '',
    type: options.type ?? 'tool',
    main: 'index.js',
    inject: options.inject,
    injectOptional: options.injectOptional,
    dependencies: options.dependencies,
  };

  const validation = validatePluginManifest(manifest);
  if (!validation.valid) {
    const details = validation.errors.map((e) => e.message).join('; ');
    throw new Error(`插件清单校验失败: ${details}`);
  }

  return [
    { path: 'package.json', content: renderPackageJson(options) },
    { path: 'index.js', content: renderEntryFile(options) },
    { path: 'README.md', content: renderReadme(options) },
  ];
}

/**
 * 将模板写入指定目录
 * @param dir 目标目录（不存在则创建）
 * @param options 脚手架选项
 * @returns 写入的文件相对路径列表
 */
export function writePluginTemplate(
  dir: string,
  options: PluginScaffoldOptions
): string[] {
  const files = generatePluginTemplate(options);

  for (const file of files) {
    const fullPath = join(dir, file.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, 'utf8');
  }

  return files.map((f) => f.path);
}
