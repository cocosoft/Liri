/**
 * UtilityTools 共享辅助函数
 * 从 UtilityTools.ts 拆出，降低文件体积
 */
import type { Tool, ToolParam, ToolTag } from './types/Tool';

export interface ToolFactoryFn {
  (): Tool[];
}

export function booleanParam(name: string, desc: string, required = false): ToolParam {
  return { name, type: 'boolean', description: desc, required };
}

export function stringParam(name: string, desc: string, required = false): ToolParam {
  return { name, type: 'string', description: desc, required };
}

export function numberParam(name: string, desc: string, required = false): ToolParam {
  return { name, type: 'number', description: desc, required };
}

export function anyParam(name: string, desc: string, required = false): ToolParam {
  return { name, type: 'object', description: desc, required };
}

export type ToolExecResult = { success: boolean; output?: string; error?: string };

export function makeTool(def: {
  name: string;
  description: string;
  params: ToolParam[];
  aliases?: string[];
  tags?: ToolTag[];
  execute:
    | ((input: Record<string, unknown>) => ToolExecResult)
    | ((input: Record<string, unknown>) => Promise<ToolExecResult>);
}): Tool {
  return {
    name: def.name,
    description: def.description,
    params: def.params,
    aliases: def.aliases,
    tags: def.tags,
    isEnabled: () => true,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    execute: async (input: Record<string, unknown>) => def.execute(input),
    getInfo: () => ({
      name: def.name,
      description: def.description,
      params: def.params,
      aliases: def.aliases,
      tags: def.tags,
      enabled: true,
      readOnly: true,
      destructive: false,
      concurrencySafe: true,
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'block' as const,
    }),
  };
}

/**
 * 更新 Markdown 文档中的指定段落
 * 查找 ## sectionName 段落并替换其内容，若不存在则追加到末尾
 */
export function updateMarkdownSection(
  content: string,
  sectionName: string,
  sectionContent: string
): string {
  const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `(## ${escapedName}\\n\\n)[\\s\\S]*?(?=\\n## |\\n*$)`,
    'm'
  );
  if (regex.test(content)) {
    return content.replace(regex, `$1${sectionContent}`);
  }
  return (
    content.replace(/\n*$/, '') + `\n\n## ${sectionName}\n\n${sectionContent}\n`
  );
}
