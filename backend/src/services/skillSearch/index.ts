/**
 * 技能搜索服务
 *
 * 提供技能（Skills）的搜索、发现和过滤功能。
 * 技能是通过 SKILL.md 文件定义的提示命令，为模型提供专业化能力。
 */
import { readdir, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename, dirname } from 'path';

/**
 * 技能定义
 */
export interface SkillDefinition {
  name: string;
  description: string;
  filePath: string;
  loadedFrom: 'skills' | 'bundled' | 'plugin' | 'mcp';
  tags?: string[];
  whenToUse?: string;
  hasUserSpecifiedDescription?: boolean;
}

/**
 * 技能搜索结果
 */
export interface SkillSearchResult {
  skills: SkillDefinition[];
  totalCount: number;
  matchedCount: number;
  query: string;
}

/**
 * 技能搜索选项
 */
export interface SkillSearchOptions {
  query?: string;
  tags?: string[];
  loadedFrom?: SkillDefinition['loadedFrom'];
  limit?: number;
  offset?: number;
}

/**
 * 从目录扫描技能
 *
 * 扫描指定目录中的 SKILL.md 文件，解析技能定义。
 *
 * @param dir - 要扫描的目录
 * @returns 发现的技能列表
 */
export async function scanSkillsFromDirectory(
  dir: string
): Promise<SkillDefinition[]> {
  if (!existsSync(dir)) return [];

  const skills: SkillDefinition[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = join(dir, entry.name);
    const skillFile = join(skillDir, 'SKILL.md');

    if (!existsSync(skillFile)) continue;

    try {
      const content = await readFile(skillFile, 'utf-8');
      const skill = parseSkillFile(content, skillFile);
      if (skill) {
        skills.push(skill);
      }
    } catch {
      // 跳过无法解析的技能文件
    }
  }

  return skills;
}

/**
 * 解析 SKILL.md 文件
 *
 * SKILL.md 使用 YAML frontmatter 格式：
 * ---
 * name: skill-name
 * description: what the skill does
 * ---
 * Instructions for Claude
 */
export function parseSkillFile(
  content: string,
  filePath: string
): SkillDefinition | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);

  if (!frontmatterMatch) return null;

  const frontmatter = frontmatterMatch[1];
  const nameMatch = frontmatter.match(/name:\s*(.+)/);
  const descMatch = frontmatter.match(/description:\s*(.+)/);
  const tagsMatch = frontmatter.match(/tags:\s*\[([^\]]*)\]/);

  if (!nameMatch) return null;

  const name = nameMatch[1].trim();

  return {
    name,
    description: descMatch ? descMatch[1].trim() : '',
    filePath,
    loadedFrom: 'skills',
    tags: tagsMatch
      ? tagsMatch[1].split(',').map((t) => t.trim().replace(/['"]/g, ''))
      : undefined,
  };
}

/**
 * 搜索技能
 *
 * 在给定的技能列表中搜索匹配的技能。
 * 支持按名称、描述和标签模糊匹配。
 *
 * @param skills - 技能列表
 * @param options - 搜索选项
 * @returns 搜索结果
 */
export function searchSkills(
  skills: SkillDefinition[],
  options: SkillSearchOptions = {}
): SkillSearchResult {
  const { query, tags, loadedFrom, limit, offset } = options;
  let filtered = [...skills];

  // 按来源过滤
  if (loadedFrom) {
    filtered = filtered.filter((s) => s.loadedFrom === loadedFrom);
  }

  // 按标签过滤
  if (tags && tags.length > 0) {
    filtered = filtered.filter((s) => {
      if (!s.tags || s.tags.length === 0) return false;
      return tags.some((t) => s.tags!.includes(t));
    });
  }

  // 按文本搜索
  if (query) {
    const lowerQuery = query.toLowerCase();
    filtered = filtered.filter((s) => {
      const nameMatch = s.name.toLowerCase().includes(lowerQuery);
      const descMatch = s.description.toLowerCase().includes(lowerQuery);
      const tagMatch = s.tags?.some((t) =>
        t.toLowerCase().includes(lowerQuery)
      );
      return nameMatch || descMatch || tagMatch;
    });
  }

  // 分页
  const totalCount = filtered.length;
  if (offset) filtered = filtered.slice(offset);
  if (limit) filtered = filtered.slice(0, limit);

  return {
    skills: filtered,
    totalCount: skills.length,
    matchedCount: totalCount,
    query: query ?? '',
  };
}

/**
 * 为当前任务发现最相关的技能
 *
 * 根据任务描述搜索技能，返回最多 limit 个最匹配的技能。
 *
 * @param skills - 技能列表
 * @param taskDescription - 任务描述
 * @param limit - 返回数量上限
 * @returns 最相关的技能
 */
export function discoverSkillsForTask(
  skills: SkillDefinition[],
  taskDescription: string,
  limit: number = 5
): SkillDefinition[] {
  const terms = taskDescription
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 3);

  const scored = skills.map((skill) => {
    let score = 0;

    for (const term of terms) {
      if (skill.name.toLowerCase().includes(term)) score += 3;
      if (skill.description.toLowerCase().includes(term)) score += 2;
      if (skill.whenToUse?.toLowerCase().includes(term)) score += 1;
      if (skill.tags?.some((t) => t.toLowerCase().includes(term))) score += 1;
    }

    return { skill, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.skill);
}

/**
 * 合并多个来源的技能列表（去重）
 */
export function mergeSkills(
  ...skillLists: SkillDefinition[][]
): SkillDefinition[] {
  const seen = new Set<string>();
  const result: SkillDefinition[] = [];

  for (const list of skillLists) {
    for (const skill of list) {
      if (!seen.has(skill.name)) {
        seen.add(skill.name);
        result.push(skill);
      }
    }
  }

  return result;
}
