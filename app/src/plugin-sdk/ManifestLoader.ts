/**
 * PluginManifestLoader - 插件清单加载器
 *
 * 支持从 package.json（pyapp 字段）、plugin.json、plugin.yaml 加载插件清单。
 * 对标 Hermes plugin.yaml 规范。
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

import type {
  PluginManifest,
  PluginSkillManifest,
  PluginHookManifest,
  PluginValidationResult,
  PluginValidationError,
  PluginValidationWarning,
} from './types';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('plugin-sdk:ManifestLoader');

/** 支持的清单文件名（按优先级排序） */
const MANIFEST_FILENAMES = [
  'plugin.yaml',
  'plugin.yml',
  'plugin.json',
  'package.json',
];

/** YAML 键值对解析（极简实现，仅支持 plugin.yaml 常用结构） */
function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split('\n');
  const stack: Array<{
    indent: number;
    key: string;
    obj: Record<string, unknown>;
  }> = [{ indent: -1, key: '', obj: result }];

  for (const rawLine of lines) {
    const trimmed = rawLine.trimEnd();
    if (trimmed.trim() === '' || trimmed.trim().startsWith('#')) continue;

    const indent = trimmed.length - trimmed.trimStart().length;
    const content = trimmed.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    if (content.endsWith(':')) {
      const key = content.slice(0, -1).trim();
      const newObj: Record<string, unknown> = {};
      const parent = stack[stack.length - 1].obj;
      const arr = findParentArray(parent);
      if (arr !== undefined) {
        const item: Record<string, unknown> = {};
        item[key] = newObj;
        arr.push(item);
        stack.push({ indent, key, obj: newObj });
      } else {
        parent[key] = newObj;
        stack.push({ indent, key, obj: newObj });
      }
    } else if (content.startsWith('- ')) {
      const listItem = content.slice(2).trim();
      const parent = stack[stack.length - 1].obj;
      for (const k of Object.keys(parent)) {
        if (!Array.isArray(parent[k])) {
          parent[k] = [];
        }
        (parent[k] as unknown[]).push(listItem || {});
      }
    } else {
      const colonIdx = content.indexOf(':');
      if (colonIdx > 0) {
        const key = content.slice(0, colonIdx).trim();
        let value: unknown = content.slice(colonIdx + 1).trim();
        if (typeof value === 'string') {
          if (value === 'true') value = true;
          else if (value === 'false') value = false;
          else if (/^\d+$/.test(value)) value = parseInt(value, 10);
          else if (/^\d+\.\d+$/.test(value)) value = parseFloat(value);
          else if (
            (value as string).startsWith('"') &&
            (value as string).endsWith('"')
          ) {
            value = (value as string).slice(1, -1);
          }
        }
        const parent = stack[stack.length - 1].obj;
        const arr = findParentArray(parent);
        if (arr !== undefined) {
          const item: Record<string, unknown> = {};
          item[key] = value;
          arr.push(item);
        } else {
          parent[key] = value;
        }
      }
    }
  }

  return result;
}

function findParentArray(obj: Record<string, unknown>): unknown[] | undefined {
  for (const key of Object.keys(obj)) {
    if (key.startsWith('__array__')) {
      return obj[key] as unknown[];
    }
  }
  return undefined;
}

/** 查找清单文件路径 */
function findManifestFile(
  dir: string
): { path: string; format: 'json' | 'yaml' | 'package' } | null {
  for (const filename of MANIFEST_FILENAMES) {
    const fullPath = join(dir, filename);
    if (existsSync(fullPath)) {
      if (filename === 'package.json')
        return { path: fullPath, format: 'package' };
      if (filename.endsWith('.yaml') || filename.endsWith('.yml'))
        return { path: fullPath, format: 'yaml' };
      return { path: fullPath, format: 'json' };
    }
  }
  return null;
}

/** 从 JSON 对象中提取 plugin manifest */
function extractFromJson(
  data: Record<string, unknown>,
  format: 'json' | 'yaml' | 'package'
): Partial<PluginManifest> | null {
  if (format === 'package') {
    const pyapp = data['pyapp'];
    if (!pyapp || typeof pyapp !== 'object') return null;
    return pyapp as unknown as PluginManifest;
  }
  return data as unknown as PluginManifest;
}

/** 验证必填字段 */
function validateManifest(
  manifest: Partial<PluginManifest>,
  source: string
): PluginValidationResult {
  const errors: PluginValidationError[] = [];
  const warnings: PluginValidationWarning[] = [];

  const requiredFields: Array<{ field: keyof PluginManifest; label: string }> =
    [
      { field: 'id', label: 'id' },
      { field: 'name', label: 'name' },
      { field: 'version', label: 'version' },
      { field: 'description', label: 'description' },
      { field: 'author', label: 'author' },
      { field: 'type', label: 'type' },
      { field: 'main', label: 'main' },
    ];

  for (const { field, label } of requiredFields) {
    if (!manifest[field]) {
      errors.push({
        field: label,
        message: `缺少必填字段: ${label}`,
        code: 'MISSING_REQUIRED_FIELD',
      });
    }
  }

  if (typeof manifest.engine === 'string' && manifest.version) {
    const validEngines = ['>=1.0.0', '>=2.0.0', '>=3.0.0'];
    if (!validEngines.includes(manifest.engine)) {
      warnings.push({
        field: 'engine',
        message: `引擎版本 "${manifest.engine}" 不在推荐范围内`,
        code: 'UNSUPPORTED_ENGINE',
      });
    }
  }

  if (manifest.skills && Array.isArray(manifest.skills)) {
    for (const skill of manifest.skills as PluginSkillManifest[]) {
      if (!skill.id || !skill.name) {
        errors.push({
          field: 'skills',
          message: '技能缺少 id 或 name',
          code: 'INVALID_SKILL',
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/** 加载插件清单 */
export function loadPluginManifest(dir: string): {
  manifest: PluginManifest | null;
  validation: PluginValidationResult;
  source: string;
} {
  const found = findManifestFile(dir);

  if (!found) {
    return {
      manifest: null,
      validation: {
        valid: false,
        errors: [
          {
            field: 'file',
            message: '未找到插件清单文件',
            code: 'MANIFEST_NOT_FOUND',
          },
        ],
        warnings: [],
      },
      source: dir,
    };
  }

  try {
    const content = readFileSync(found.path, 'utf-8');
    let raw: Record<string, unknown>;

    if (found.format === 'yaml') {
      raw = parseSimpleYaml(content);
    } else {
      raw = JSON.parse(content) as Record<string, unknown>;
    }

    const partial = extractFromJson(raw, found.format);
    if (!partial) {
      return {
        manifest: null,
        validation: {
          valid: false,
          errors: [
            {
              field: 'pyapp',
              message: 'package.json 中缺少 "pyapp" 字段',
              code: 'MISSING_PYAPP_FIELD',
            },
          ],
          warnings: [],
        },
        source: found.path,
      };
    }

    const validation = validateManifest(partial, found.path);

    return {
      manifest: validation.valid ? (partial as PluginManifest) : null,
      validation,
      source: found.path,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      manifest: null,
      validation: {
        valid: false,
        errors: [
          {
            field: 'file',
            message: `解析清单失败: ${message}`,
            code: 'PARSE_ERROR',
          },
        ],
        warnings: [],
      },
      source: found.path,
    };
  }
}

/** 批量加载目录中的插件清单 */
export function loadPluginManifests(dirs: string[]): Array<{
  manifest: PluginManifest | null;
  validation: PluginValidationResult;
  source: string;
}> {
  return dirs.map((dir) => loadPluginManifest(dir));
}

/** 获取清单中的技能列表 */
export function getPluginSkills(
  manifest: PluginManifest
): PluginSkillManifest[] {
  return manifest.skills || [];
}

/** 获取清单中的钩子列表 */
export function getPluginHooks(manifest: PluginManifest): PluginHookManifest[] {
  return manifest.hooks || [];
}
