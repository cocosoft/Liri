/**
 * Markdown配置加载器
 */

/**
 * 从frontmatter解析Agent工具
 */
import { readdir } from 'node:fs/promises';
import { join } from 'path';
import { existsSync } from 'node:fs';

export async function loadMarkdownFilesForSubdir(
  subdir: string,
  cwd: string
): Promise<string[]> {
  const dirPath = join(cwd, subdir);
  if (!existsSync(dirPath)) return [];
  const files = await readdir(dirPath);
  return files
    .filter((f) => f.endsWith('.md') || f.endsWith('.mdx'))
    .map((f) => join(dirPath, f));
}

export function parseAgentToolsFromFrontmatter(
  toolsRaw: unknown
): string[] | undefined {
  if (!toolsRaw) {
    return undefined;
  }

  if (typeof toolsRaw === 'string') {
    return toolsRaw
      .split(',')
      .map((tool) => tool.trim())
      .filter(Boolean);
  }

  if (Array.isArray(toolsRaw)) {
    return toolsRaw
      .filter((tool) => typeof tool === 'string')
      .map((tool) => tool.trim());
  }

  return undefined;
}

/**
 * 从frontmatter解析斜杠命令工具
 */
export function parseSlashCommandToolsFromFrontmatter(
  skillsRaw: unknown
): string[] | undefined {
  if (!skillsRaw) {
    return undefined;
  }

  if (typeof skillsRaw === 'string') {
    return skillsRaw
      .split(',')
      .map((skill) => skill.trim())
      .filter(Boolean);
  }

  if (Array.isArray(skillsRaw)) {
    return skillsRaw
      .filter((skill) => typeof skill === 'string')
      .map((skill) => skill.trim());
  }

  return undefined;
}
