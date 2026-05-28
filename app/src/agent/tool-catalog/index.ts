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
 * Tool Catalog 工具目录管理系统
 * 对标 OpenClaw agents/tool-catalog.ts
 *
 * 提供工具的分类、分组、Profile 映射和查询功能
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 工具 Profile 类型
 */
export type ToolProfileId = 'minimal' | 'coding' | 'messaging' | 'full';

/**
 * 工具分类区块
 */
export interface ToolSection {
  /** 分类 ID */
  id: string;
  /** 分类显示名 */
  label: string;
  /** 该分类下的工具列表 */
  tools: ToolCatalogItem[];
}

/**
 * 工具目录条目
 */
export interface ToolCatalogItem {
  /** 工具 ID */
  id: string;
  /** 工具显示名 */
  label: string;
  /** 工具描述 */
  description: string;
}

/**
 * 核心工具定义（内部使用）
 */
interface CoreToolDefinition {
  id: string;
  label: string;
  description: string;
  sectionId: string;
  profiles: ToolProfileId[];
  includeInOpenClawGroup?: boolean;
}

/**
 * 分类区块的显示顺序和名称
 */
const SECTION_ORDER: Array<{ id: string; label: string }> = [
  { id: 'fs', label: 'Files' },
  { id: 'runtime', label: 'Runtime' },
  { id: 'web', label: 'Web' },
  { id: 'memory', label: 'Memory' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'ui', label: 'UI' },
  { id: 'messaging', label: 'Messaging' },
  { id: 'automation', label: 'Automation' },
  { id: 'agents', label: 'Agents' },
  { id: 'media', label: 'Media' },
];

/**
 * 核心工具定义列表
 */
const CORE_TOOL_DEFINITIONS: CoreToolDefinition[] = [
  // Files
  {
    id: 'read',
    label: 'read',
    description: 'Read file contents',
    sectionId: 'fs',
    profiles: ['coding'],
  },
  {
    id: 'write',
    label: 'write',
    description: 'Create or overwrite files',
    sectionId: 'fs',
    profiles: ['coding'],
  },
  {
    id: 'edit',
    label: 'edit',
    description: 'Make precise edits to files',
    sectionId: 'fs',
    profiles: ['coding'],
  },
  {
    id: 'apply_patch',
    label: 'apply_patch',
    description: 'Apply patches to files',
    sectionId: 'fs',
    profiles: ['coding'],
  },
  {
    id: 'glob',
    label: 'glob',
    description: 'List files matching glob patterns',
    sectionId: 'fs',
    profiles: ['coding'],
    includeInOpenClawGroup: true,
  },
  {
    id: 'grep',
    label: 'grep',
    description: 'Search file contents with regex',
    sectionId: 'fs',
    profiles: ['coding'],
    includeInOpenClawGroup: true,
  },

  // Runtime
  {
    id: 'exec',
    label: 'exec',
    description: 'Execute shell commands',
    sectionId: 'runtime',
    profiles: ['coding'],
  },
  {
    id: 'process',
    label: 'process',
    description: 'Manage long-running processes',
    sectionId: 'runtime',
    profiles: ['coding'],
  },
  {
    id: 'bash',
    label: 'bash',
    description: 'Execute bash commands interactively',
    sectionId: 'runtime',
    profiles: ['coding'],
  },
  {
    id: 'powershell',
    label: 'powershell',
    description: 'Execute PowerShell commands',
    sectionId: 'runtime',
    profiles: ['coding'],
  },

  // Web
  {
    id: 'web_search',
    label: 'web_search',
    description: 'Search the web for information',
    sectionId: 'web',
    profiles: ['coding'],
    includeInOpenClawGroup: true,
  },
  {
    id: 'web_fetch',
    label: 'web_fetch',
    description: 'Fetch and extract web page content',
    sectionId: 'web',
    profiles: ['coding'],
    includeInOpenClawGroup: true,
  },

  // Memory
  {
    id: 'memory_search',
    label: 'memory_search',
    description: 'Semantic search across memory',
    sectionId: 'memory',
    profiles: ['coding'],
    includeInOpenClawGroup: true,
  },
  {
    id: 'memory_get',
    label: 'memory_get',
    description: 'Read stored memory entries',
    sectionId: 'memory',
    profiles: ['coding'],
    includeInOpenClawGroup: true,
  },
  {
    id: 'knowledge_search',
    label: 'knowledge_search',
    description:
      'Search across knowledge base documents, docs, and wiki articles',
    sectionId: 'memory',
    profiles: ['coding'],
    includeInOpenClawGroup: true,
  },
  {
    id: 'unified_search',
    label: 'unified_search',
    description: 'Unified search across knowledge base and memory system',
    sectionId: 'memory',
    profiles: ['coding'],
    includeInOpenClawGroup: true,
  },
  {
    id: 'knowledge_write',
    label: 'knowledge_write',
    description:
      'Create or update knowledge base documents to persist important information and learnings',
    sectionId: 'memory',
    profiles: ['coding'],
  },
  {
    id: 'knowledge_delete',
    label: 'knowledge_delete',
    description:
      'Delete knowledge base documents by title (requires confirmation)',
    sectionId: 'memory',
    profiles: ['coding'],
  },
  {
    id: 'todo_write',
    label: 'todo_write',
    description: 'Write task tracking entries',
    sectionId: 'memory',
    profiles: ['coding'],
  },

  // Sessions
  {
    id: 'sessions_list',
    label: 'sessions_list',
    description: 'List active agent sessions',
    sectionId: 'sessions',
    profiles: ['coding', 'messaging'],
  },
  {
    id: 'sessions_history',
    label: 'sessions_history',
    description: 'View session conversation history',
    sectionId: 'sessions',
    profiles: ['coding', 'messaging'],
  },
  {
    id: 'sessions_send',
    label: 'sessions_send',
    description: 'Send messages to active sessions',
    sectionId: 'sessions',
    profiles: ['coding', 'messaging'],
  },
  {
    id: 'sessions_spawn',
    label: 'sessions_spawn',
    description: 'Spawn new sub-agent sessions',
    sectionId: 'sessions',
    profiles: ['coding'],
  },
  {
    id: 'sessions_yield',
    label: 'sessions_yield',
    description: 'Yield control to sub-agent results',
    sectionId: 'sessions',
    profiles: ['coding'],
  },
  {
    id: 'session_status',
    label: 'session_status',
    description: 'Check current session status',
    sectionId: 'sessions',
    profiles: ['minimal', 'coding', 'messaging'],
  },

  // UI
  {
    id: 'browser',
    label: 'browser',
    description: 'Control a web browser',
    sectionId: 'ui',
    profiles: [],
  },
  {
    id: 'canvas',
    label: 'canvas',
    description: 'Render content on canvas',
    sectionId: 'ui',
    profiles: [],
  },
  {
    id: 'voice_input',
    label: 'voice_input',
    description: 'Capture voice input',
    sectionId: 'ui',
    profiles: [],
  },
  {
    id: 'voice_output',
    label: 'voice_output',
    description: 'Play voice output',
    sectionId: 'ui',
    profiles: [],
  },

  // Messaging
  {
    id: 'send_message',
    label: 'send_message',
    description: 'Send messages to users',
    sectionId: 'messaging',
    profiles: ['messaging'],
  },
  {
    id: 'push_notification',
    label: 'push_notification',
    description: 'Send push notifications',
    sectionId: 'messaging',
    profiles: ['messaging'],
  },

  // Automation
  {
    id: 'cron',
    label: 'cron',
    description: 'Schedule and manage cron jobs',
    sectionId: 'automation',
    profiles: ['coding'],
  },
  {
    id: 'gateway',
    label: 'gateway',
    description: 'Control API gateway',
    sectionId: 'automation',
    profiles: [],
  },

  // Agents
  {
    id: 'agents_list',
    label: 'agents_list',
    description: 'List available agents',
    sectionId: 'agents',
    profiles: [],
  },
  {
    id: 'update_plan',
    label: 'update_plan',
    description: 'Update execution plan',
    sectionId: 'agents',
    profiles: ['coding'],
  },
  {
    id: 'task',
    label: 'task',
    description: 'Create and manage tasks',
    sectionId: 'agents',
    profiles: ['coding'],
  },

  // Media
  {
    id: 'image',
    label: 'image',
    description: 'Image understanding and analysis',
    sectionId: 'media',
    profiles: ['coding'],
  },
  {
    id: 'image_generate',
    label: 'image_generate',
    description: 'Generate images from prompts',
    sectionId: 'media',
    profiles: ['coding'],
  },
  {
    id: 'music_generate',
    label: 'music_generate',
    description: 'Generate music from prompts',
    sectionId: 'media',
    profiles: ['coding'],
  },
  {
    id: 'video_generate',
    label: 'video_generate',
    description: 'Generate video from prompts',
    sectionId: 'media',
    profiles: ['coding'],
  },
  {
    id: 'tts',
    label: 'tts',
    description: 'Text-to-speech conversion',
    sectionId: 'media',
    profiles: [],
  },
];

/**
 * Profile 策略定义
 */
const PROFILE_POLICIES: Record<ToolProfileId, { allow?: string[] }> = {
  minimal: {
    allow: CORE_TOOL_DEFINITIONS.filter((t) =>
      t.profiles.includes('minimal')
    ).map((t) => t.id),
  },
  coding: {
    allow: [
      ...CORE_TOOL_DEFINITIONS.filter((t) => t.profiles.includes('coding')).map(
        (t) => t.id
      ),
      'bundle-mcp',
    ],
  },
  messaging: {
    allow: [
      ...CORE_TOOL_DEFINITIONS.filter((t) =>
        t.profiles.includes('messaging')
      ).map((t) => t.id),
      'bundle-mcp',
    ],
  },
  full: {},
};

/**
 * ToolCatalog
 * 工具目录管理器，提供分类、查询、Profile 映射功能
 */
export class ToolCatalog {
  private definitionsById: Map<string, CoreToolDefinition>;

  constructor() {
    this.definitionsById = new Map(CORE_TOOL_DEFINITIONS.map((t) => [t.id, t]));
  }

  /**
   * 获取所有分类区块
   */
  getSections(): ToolSection[] {
    return SECTION_ORDER.map((section) => ({
      id: section.id,
      label: section.label,
      tools: CORE_TOOL_DEFINITIONS.filter(
        (t) => t.sectionId === section.id
      ).map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
      })),
    })).filter((section) => section.tools.length > 0);
  }

  /**
   * 获取指定分类下的工具列表
   */
  getSection(sectionId: string): ToolSection | undefined {
    const section = SECTION_ORDER.find((s) => s.id === sectionId);
    if (!section) {
      return undefined;
    }
    const tools = CORE_TOOL_DEFINITIONS.filter(
      (t) => t.sectionId === sectionId
    ).map((t) => ({
      id: t.id,
      label: t.label,
      description: t.description,
    }));
    if (tools.length === 0) {
      return undefined;
    }
    return { id: section.id, label: section.label, tools };
  }

  /**
   * 获取指定 Profile 允许的工具 ID 列表
   */
  getToolsByProfile(profile: ToolProfileId): string[] {
    const policy = PROFILE_POLICIES[profile];
    if (!policy) {
      return [];
    }
    if (profile === 'full') {
      return CORE_TOOL_DEFINITIONS.map((t) => t.id);
    }
    return policy.allow ?? [];
  }

  /**
   * 获取指定 Profile 的完整策略
   */
  getProfilePolicy(profile: ToolProfileId): { allow?: string[] } | undefined {
    return PROFILE_POLICIES[profile]
      ? { ...PROFILE_POLICIES[profile] }
      : undefined;
  }

  /**
   * 获取工具的 Profile 归属
   */
  getToolProfiles(toolId: string): ToolProfileId[] {
    const def = this.definitionsById.get(toolId);
    if (!def) {
      return [];
    }
    return [...def.profiles];
  }

  /**
   * 获取工具描述
   */
  getToolDescription(toolId: string): string | undefined {
    return this.definitionsById.get(toolId)?.description;
  }

  /**
   * 检查工具是否为已知的核心工具
   */
  isKnownTool(toolId: string): boolean {
    return this.definitionsById.has(toolId);
  }

  /**
   * 搜索工具
   */
  search(query: string): ToolCatalogItem[] {
    const q = query.toLowerCase();
    const results = CORE_TOOL_DEFINITIONS.filter(
      (t) =>
        t.id.includes(q) ||
        t.label.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.sectionId.includes(q)
    );
    return results.map((t) => ({
      id: t.id,
      label: t.label,
      description: t.description,
    }));
  }

  /**
   * 获取所有可用的分类区块 ID
   */
  getSectionIds(): string[] {
    return SECTION_ORDER.map((s) => s.id);
  }

  /**
   * 获取所有可用 Profile
   */
  getProfiles(): Array<{ id: ToolProfileId; label: string }> {
    return [
      { id: 'minimal', label: 'Minimal' },
      { id: 'coding', label: 'Coding' },
      { id: 'messaging', label: 'Messaging' },
      { id: 'full', label: 'Full' },
    ];
  }

  /**
   * 获取核心工具的工具组映射
   */
  getToolGroups(): Record<string, string[]> {
    const groups: Record<string, string[]> = {};

    for (const section of SECTION_ORDER) {
      const tools = CORE_TOOL_DEFINITIONS.filter(
        (t) => t.sectionId === section.id
      ).map((t) => t.id);
      if (tools.length > 0) {
        groups[`group:${section.id}`] = tools;
      }
    }

    groups['group:openclaw'] = CORE_TOOL_DEFINITIONS.filter(
      (t) => t.includeInOpenClawGroup
    ).map((t) => t.id);

    return groups;
  }

  /**
   * 获取工具总数
   */
  getToolCount(): number {
    return CORE_TOOL_DEFINITIONS.length;
  }
}

/**
 * 创建默认的工具目录实例
 */
export function createToolCatalog(): ToolCatalog {
  return new ToolCatalog();
}
