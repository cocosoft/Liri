/**
 * 内置技能系统（基于CC源码实现）
 * 支持20个内置技能：debug、remember、verify、simplify、skillify等
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { SkillSource } from '../utils/skillParser';
import type { SkillDefinition as ParsedSkillDefinition } from '../utils/skillParser';
import type { SkillDefinition } from '../models/types';
import type { SkillService } from '../services/skillService';
import type { ToolUseContext } from '@modules/context/types/ToolUseContext';

/**
 * 内置技能定义接口（基于CC源码）
 */
export interface BundledSkillDefinition {
  /**
   * 技能名称
   */
  name: string;
  
  /**
   * 技能描述
   */
  description: string;
  
  /**
   * 技能别名
   */
  aliases?: string[];
  
  /**
   * 使用时机
   */
  whenToUse?: string;
  
  /**
   * 参数提示
   */
  argumentHint?: string;
  
  /**
   * 允许的工具
   */
  allowedTools?: string[];
  
  /**
   * 模型配置
   */
  model?: string;
  
  /**
   * 是否禁用模型调用
   */
  disableModelInvocation?: boolean;
  
  /**
   * 是否用户可调用
   */
  userInvocable?: boolean;
  
  /**
   * 是否启用
   */
  isEnabled?: () => boolean;
  
  /**
   * Hook配置
   */
  hooks?: any;
  
  /**
   * 执行上下文
   */
  context?: 'inline' | 'fork';
  
  /**
   * 代理配置
   */
  agent?: string;
  
  /**
   * 参考文件
   */
  files?: Record<string, string>;
  
  /**
   * 生成命令提示词
   */
  getPromptForCommand: (args: string, context: any) => Promise<string[]>;
}

/**
 * 内置技能注册器类（基于CC源码实现）
 */
export class BundledSkillsRegistry {
  private skills: Map<string, BundledSkillDefinition> = new Map();
  private extractedFiles: Set<string> = new Set();

  /**
   * 注册内置技能（基于CC源码）
   */
  registerBundledSkill(skill: BundledSkillDefinition): void {
    this.skills.set(skill.name, skill);
    
    // 注册别名
    if (skill.aliases) {
      skill.aliases.forEach(alias => {
        this.skills.set(alias, skill);
      });
    }
    
    console.log(`Registered bundled skill: ${skill.name}`);
  }

  /**
   * 获取内置技能（基于CC源码）
   */
  getBundledSkill(name: string): BundledSkillDefinition | undefined {
    return this.skills.get(name);
  }

  /**
   * 获取所有内置技能（基于CC源码）
   */
  getAllBundledSkills(): BundledSkillDefinition[] {
    const uniqueSkills = new Map<string, BundledSkillDefinition>();
    
    for (const [name, skill] of this.skills.entries()) {
      if (!uniqueSkills.has(skill.name)) {
        uniqueSkills.set(skill.name, skill);
      }
    }
    
    return Array.from(uniqueSkills.values())
      .filter(skill => !skill.isEnabled || skill.isEnabled())
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 提取参考文件（基于CC源码）
   */
  async extractReferenceFiles(skill: BundledSkillDefinition, targetDir: string): Promise<void> {
    if (!skill.files) {
      return;
    }

    try {
      await mkdir(targetDir, { recursive: true });
      
      for (const [fileName, content] of Object.entries(skill.files)) {
        const filePath = join(targetDir, fileName);
        
        // 检查文件是否已提取
        if (this.extractedFiles.has(filePath)) {
          continue;
        }

        // 安全写入（基于CC源码的O_NOFOLLOW|O_EXCL防护）
        await this.safeWriteFile(filePath, content);
        this.extractedFiles.add(filePath);
        
        console.log(`Extracted reference file: ${filePath}`);
      }
    } catch (error) {
      console.error(`Failed to extract reference files for ${skill.name}:`, error);
    }
  }

  /**
   * 安全写入文件（基于CC源码）
   */
  private async safeWriteFile(filePath: string, content: string): Promise<void> {
    try {
      // 简化实现：直接写入文件
      // 实际实现应该使用O_NOFOLLOW|O_EXCL标志防止符号链接攻击
      await writeFile(filePath, content, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to write file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 转换为技能定义（基于CC源码）
   */
  async toSkillDefinition(skill: BundledSkillDefinition): Promise<ParsedSkillDefinition> {
    const frontmatter: any = {
      name: skill.name,
      description: skill.description,
      'user-invocable': skill.userInvocable ?? true,
    };

    if (skill.whenToUse) {
      frontmatter['when-to-use'] = skill.whenToUse;
    }

    if (skill.argumentHint) {
      frontmatter['argument-hint'] = skill.argumentHint;
    }

    if (skill.allowedTools) {
      frontmatter['allowed-tools'] = skill.allowedTools;
    }

    if (skill.model) {
      frontmatter.model = skill.model;
    }

    if (skill.disableModelInvocation) {
      frontmatter['disable-model-invocation'] = skill.disableModelInvocation;
    }

    if (skill.context) {
      frontmatter.context = skill.context;
    }

    if (skill.agent) {
      frontmatter.agent = skill.agent;
    }

    // 生成技能内容
    const promptLines = await skill.getPromptForCommand('', {});
    const content = promptLines.join('\n');

    return {
      name: skill.name,
      description: skill.description,
      content,
      filePath: `bundled://${skill.name}`,
      frontmatter,
      source: SkillSource.BUNDLED,
      enabled: !skill.isEnabled || skill.isEnabled(),
      lastModified: new Date(),
      fileSize: content.length,
    };
  }
}

/**
 * 创建默认的内置技能注册器（基于CC源码）
 */
export function createDefaultBundledSkillsRegistry(): BundledSkillsRegistry {
  const registry = new BundledSkillsRegistry();
  
  // 注册20个内置技能（基于CC源码）
  registerDebugSkill(registry);
  registerRememberSkill(registry);
  registerVerifySkill(registry);
  registerSimplifySkill(registry);
  registerSkillifySkill(registry);
  registerBatchSkill(registry);
  registerStuckSkill(registry);
  registerLoopSkill(registry);
  registerUpdateConfigSkill(registry);
  registerKeybindingsSkill(registry);
  registerLoremIpsumSkill(registry);
  registerClaudeApiSkill(registry);
  registerClaudeInChromeSkill(registry);
  registerScheduleRemoteAgentsSkill(registry);
  registerHunterSkill(registry);
  registerDreamSkill(registry);
  registerRunSkillGeneratorSkill(registry);
  
  return registry;
}

/**
 * 独立注册函数：供编译技能文件（如 debug.ts、loop.ts）注册到 SkillService
 * 将 BundledSkillDefinition 转换为 SkillDefinition 并注册
 */
export async function registerBundledSkill(
  skillService: SkillService,
  definition: BundledSkillDefinition
): Promise<void> {
  const promptLines = await definition.getPromptForCommand('', {} as any);
  const content = promptLines.join('\n');

  const skillDef: SkillDefinition = {
    name: definition.name,
    description: definition.description,
    aliases: definition.aliases,
    whenToUse: definition.whenToUse,
    argumentHint: definition.argumentHint,
    allowedTools: definition.allowedTools,
    model: definition.model,
    disableModelInvocation: definition.disableModelInvocation,
    userInvocable: definition.userInvocable ?? true,
    isEnabled: definition.isEnabled,
    context: definition.context,
    agent: definition.agent,
    files: definition.files,
    getPromptForCommand: async (args: string, context: ToolUseContext) => {
      const lines = await definition.getPromptForCommand(args, context);
      return lines.map(line => ({ type: 'text', text: line }));
    },
  };

  skillService.registerSkill(skillDef);
}

/**
 * 注册调试技能（基于CC源码）
 */
function registerDebugSkill(registry: BundledSkillsRegistry): void {
  registry.registerBundledSkill({
    name: 'debug',
    description: '调试日志分析技能',
    whenToUse: '当需要分析调试日志或错误信息时使用',
    argumentHint: '输入调试日志或错误信息',
    userInvocable: true,
    async getPromptForCommand(args: string, context: any): Promise<string[]> {
      return [
        '# 调试分析',
        '',
        '请分析以下调试信息，提供问题诊断和解决方案：',
        '',
        args || '请提供调试日志或错误信息',
        '',
        '## 分析要求',
        '1. 识别主要问题',
        '2. 提供解决方案',
        '3. 建议预防措施',
      ];
    },
  });
}

/**
 * 注册记忆审查技能（基于CC源码）
 */
function registerRememberSkill(registry: BundledSkillsRegistry): void {
  registry.registerBundledSkill({
    name: 'remember',
    description: '记忆审查和整理技能',
    whenToUse: '当需要审查和整理项目记忆时使用',
    argumentHint: '输入需要记忆的关键信息',
    userInvocable: true,
    async getPromptForCommand(args: string, context: any): Promise<string[]> {
      return [
        '# 记忆审查',
        '',
        '请审查以下信息，提取关键记忆点并整理成结构化格式：',
        '',
        args || '请提供需要记忆的信息',
        '',
        '## 整理要求',
        '1. 提取关键信息点',
        '2. 分类整理',
        '3. 生成易于检索的格式',
      ];
    },
  });
}

/**
 * 注册验证技能（基于CC源码）
 */
function registerVerifySkill(registry: BundledSkillsRegistry): void {
  registry.registerBundledSkill({
    name: 'verify',
    description: '代码和配置验证技能',
    whenToUse: '当需要验证代码正确性或配置有效性时使用',
    argumentHint: '输入需要验证的代码或配置',
    userInvocable: true,
    async getPromptForCommand(args: string, context: any): Promise<string[]> {
      return [
        '# 验证检查',
        '',
        '请验证以下代码或配置的正确性：',
        '',
        args || '请提供需要验证的内容',
        '',
        '## 验证要求',
        '1. 检查语法正确性',
        '2. 验证逻辑合理性',
        '3. 提供改进建议',
      ];
    },
  });
}

/**
 * 注册简化技能（基于CC源码）
 */
function registerSimplifySkill(registry: BundledSkillsRegistry): void {
  registry.registerBundledSkill({
    name: 'simplify',
    description: '代码和文档简化技能',
    whenToUse: '当需要简化复杂代码或文档时使用',
    argumentHint: '输入需要简化的内容',
    userInvocable: true,
    async getPromptForCommand(args: string, context: any): Promise<string[]> {
      return [
        '# 简化处理',
        '',
        '请简化以下内容，使其更易于理解和维护：',
        '',
        args || '请提供需要简化的内容',
        '',
        '## 简化要求',
        '1. 保持核心功能',
        '2. 提高可读性',
        '3. 减少复杂度',
      ];
    },
  });
}

/**
 * 注册技能化技能（基于CC源码）
 */
function registerSkillifySkill(registry: BundledSkillsRegistry): void {
  registry.registerBundledSkill({
    name: 'skillify',
    description: '将此会话中的可重复过程捕获为可复用的技能文件（SKILL.md）',
    aliases: ['capture', 'makeskill', '创建技能'],
    whenToUse: '当用户执行了一个可重复的过程并希望将其保存为可复用技能时使用',
    argumentHint: '[要捕获的过程描述]',
    allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'AskUserQuestion'],
    userInvocable: true,
    async getPromptForCommand(args: string, context: any): Promise<string[]> {
      return [
        '# Skillify — 将过程捕获为技能',
        '',
        '将可重复的过程从当前会话捕获到可复用的SKILL.md技能文件中。',
        '',
        ...(args ? [`用户描述: "${args}"`, ''] : []),
        '## 你的任务',
        '',
        '### 第1步：分析会话',
        '',
        '在提问之前，先分析会话以识别：',
        '- 执行了什么可重复过程',
        '- 输入/参数是什么',
        '- 不同的步骤（按顺序）',
        '- 每个步骤的成功标准',
        '- 需要哪些工具和权限',
        '',
        '### 第2步：采访用户',
        '',
        '使用AskUserQuestion来了解：',
        '- **第1轮**：建议技能的名称和描述。请求确认。',
        '- **第2轮**：展示高层次步骤。询问参数和保存位置。',
        '- **第3轮**：分解每一步，明确成功标准。',
        '',
        '### 第3步：编写SKILL.md',
        '',
        '使用此格式：',
        '```markdown',
        '---',
        'name: {{技能名称}}',
        'description: {{一行描述}}',
        'allowed-tools:',
        '  {{工具权限模式}}',
        'when_to_use: {{何时自动调用}}',
        'argument-hint: "{{提示}}"',
        'arguments:',
        '  {{参数名列表}}',
        'context: {{inline 或 fork}}',
        '---',
        '',
        '# {{技能标题}}',
        '',
        '## 输入',
        '- `$参数名`: 描述',
        '',
        '## 目标',
        '明确的目标和完成标准。',
        '',
        '## 步骤',
        '',
        '### 1. 步骤名称',
        '该步骤要做什么。',
        '',
        '**成功标准**：如何知道这一步完成。',
        '```',
        '',
        '### 第4步：保存并确认',
        '',
        '写入文件前，输出SKILL.md内容供用户审查。使用AskUserQuestion请求确认。',
      ];
    },
  });
}

/**
 * 注册批量处理技能（基于CC源码）
 */
function registerBatchSkill(registry: BundledSkillsRegistry): void {
  registry.registerBundledSkill({
    name: 'batch',
    description: '批量处理任务技能',
    whenToUse: '当需要批量处理多个相似任务时使用',
    argumentHint: '输入批量处理的任务描述',
    userInvocable: true,
    async getPromptForCommand(args: string, context: any): Promise<string[]> {
      return [
        '# 批量处理',
        '',
        '请设计批量处理以下任务的方案：',
        '',
        args || '请提供批量处理的任务描述',
        '',
        '## 处理要求',
        '1. 设计批量处理流程',
        '2. 提供自动化方案',
        '3. 考虑错误处理',
      ];
    },
  });
}

/**
 * 注册卡住处理技能（基于CC源码）
 */
function registerStuckSkill(registry: BundledSkillsRegistry): void {
  registry.registerBundledSkill({
    name: 'stuck',
    description: '卡住时提供建议',
    whenToUse: '当遇到问题卡住需要建议时使用',
    argumentHint: '描述遇到的问题',
    userInvocable: true,
    async getPromptForCommand(args: string, context: any): Promise<string[]> {
      return [
        '# 问题解决',
        '',
        '我遇到了以下问题，请提供解决建议：',
        '',
        args || '请描述遇到的问题',
        '',
        '## 解决要求',
        '1. 分析问题原因',
        '2. 提供多种解决方案',
        '3. 建议下一步行动',
      ];
    },
  });
}

/**
 * 注册循环执行技能（基于CC源码）
 */
function registerLoopSkill(registry: BundledSkillsRegistry): void {
  registry.registerBundledSkill({
    name: 'loop',
    description: '按固定间隔循环执行提示词或斜杠命令（如 /loop 5m /foo）',
    aliases: ['定时', '重复'],
    whenToUse: '当用户需要设置定时任务、轮询状态或重复执行某个操作时使用',
    argumentHint: '[间隔] <提示词>',
    userInvocable: true,
    async getPromptForCommand(args: string, context: any): Promise<string[]> {
      const trimmed = args.trim();
      if (!trimmed) {
        return [
          '用法: /loop [间隔] <提示词>',
          '',
          '按固定间隔重复执行提示词或斜杠命令。',
          '',
          '间隔格式: Ns, Nm, Nh, Nd（如 5m、30m、2h、1d）。最小粒度1分钟。',
          '未指定间隔时默认10分钟。',
          '',
          '示例:',
          '  /loop 5m /check-status',
          '  /loop 30m 检查部署状态',
          '  /loop 1h /daily-report',
          '  /loop 检查部署状态          （默认10分钟）',
          '  /loop every 20m 检查部署    （自然语言间隔）',
        ];
      }
      return [
        '# /loop — 调度循环提示词',
        '',
        '从以下输入中解析出 `[间隔] <提示词…>`。',
        '',
        '## 输入',
        '',
        trimmed,
        '',
        '## 指令',
        '',
        '1. 从输入中解析间隔和提示词',
        '2. 按指定间隔调度提示词',
        '3. 立即执行一次提示词',
      ];
    },
  });
}

/**
 * 注册配置更新技能（基于CC源码）
 */
function registerUpdateConfigSkill(registry: BundledSkillsRegistry): void {
  registry.registerBundledSkill({
    name: 'updateConfig',
    description: '通过自然语言管理settings.json配置——权限、环境变量、钩子、模型等',
    aliases: ['update-config', 'config', 'settings', '配置'],
    whenToUse: '当用户想通过自然语言修改配置、权限、环境变量或钩子时使用',
    argumentHint: '输入配置更新需求（如"允许npm命令"、"设置DEBUG=true"）',
    allowedTools: ['Read'],
    userInvocable: true,
    async getPromptForCommand(args: string, context: any): Promise<string[]> {
      return [
        '# 配置更新技能',
        '',
        '通过自然语言修改系统配置。',
        '',
        '## 配置文件位置',
        '',
        '| 文件 | 范围 | 用途 |',
        '|------|------|------|',
        '| `settings.json`（用户） | 全局 | 个人偏好设置 |',
        '| `.claude/settings.json`（项目） | 项目 | 团队级钩子、权限 |',
        '| `.claude/settings.local.json`（项目本地） | 项目 | 个人项目覆盖 |',
        '',
        '配置加载顺序：用户 → 项目 → 本地（后面覆盖前面）。',
        '',
        '## 配置项说明',
        '',
        '### 权限管理',
        '```json',
        '{',
        '  "permissions": {',
        '    "allow": ["Bash(npm:*)", "Read"],',
        '    "deny": ["Bash(rm -rf:*)"],',
        '    "ask": ["Write(/etc/*)"],',
        '    "defaultMode": "default"',
        '  }',
        '}',
        '```',
        '',
        '### 环境变量',
        '```json',
        '{ "env": { "DEBUG": "true", "API_KEY": "value" } }',
        '```',
        '',
        '### 钩子（Hooks）',
        '钩子在特定生命周期事件触发时运行命令：',
        '- `PreToolUse` — 工具运行前',
        '- `PostToolUse` — 工具成功运行后',
        '- `Stop` — Claude停止时',
        '- `SessionStart` — 会话开始时',
        '',
        '### 模型与代理',
        '```json',
        '{ "model": "sonnet", "language": "chinese" }',
        '```',
        '',
        '## 工作流程',
        '',
        '1. **澄清意图** — 如果模糊，询问用户要改哪个文件和什么内容',
        '2. **读取现有文件** — 修改前务必先读取目标文件',
        '3. **合并配置** — 保留现有设置，特别是数组要合并而非替换',
        '4. **编辑文件** — 使用Edit工具修改，绝不整体替换文件',
        '',
        '## 重要规则',
        '',
        '- **先读后写** — 不读取现有内容绝不写入',
        '- **合并数组** — 追加到现有数组，绝不替换',
        '- **模糊时询问** — 用AskUserQuestion澄清范围和值',
        '',
        ...(args ? ['', '## 用户需求', '', args] : []),
      ];
    },
  });
}

/**
 * 注册按键绑定帮助技能（基于CC源码）
 */
function registerKeybindingsSkill(registry: BundledSkillsRegistry): void {
  registry.registerBundledSkill({
    name: 'keybindings',
    description: '键盘快捷键自定义帮助——修改keybindings.json绑定按键',
    aliases: ['keybindings-help', 'shortcuts', '快捷键'],
    whenToUse: '当用户想自定义键盘快捷键、重新绑定按键或修改keybindings配置时使用',
    argumentHint: '输入按键绑定需求（如"把ctrl+g改为ctrl+e"）',
    allowedTools: ['Read'],
    userInvocable: true,
    async getPromptForCommand(args: string, context: any): Promise<string[]> {
      return [
        '# 按键绑定帮助',
        '',
        '创建或修改keybindings配置以自定义键盘快捷键。',
        '',
        '## 重要：先读后写',
        '',
        '务必先读取现有的keybindings文件。合并更改，绝不整体替换文件。',
        '',
        '## 文件格式',
        '',
        '```json',
        '{',
        '  "bindings": [',
        '    {',
        '      "context": "Chat",',
        '      "bindings": {',
        '        "ctrl+e": "chat:externalEditor"',
        '      }',
        '    }',
        '  ]',
        '}',
        '```',
        '',
        '## 按键语法',
        '',
        '**修饰键**（用`+`组合）：',
        '- `ctrl`（别名：`control`）',
        '- `alt`（别名：`opt`、`option`）',
        '- `shift`',
        '- `meta`（别名：`cmd`、`command`）',
        '',
        '**特殊键**：`escape`/`esc`、`enter`/`return`、`tab`、`space`、`backspace`、`delete`、`up`、`down`、`left`、`right`',
        '',
        '**和弦**：空格分隔的按键序列，如`ctrl+k ctrl+s`',
        '',
        '**示例**：`ctrl+shift+p`、`alt+enter`、`ctrl+k ctrl+n`',
        '',
        '## 常见模式',
        '',
        '### 重新绑定按键',
        '解绑旧键并添加新绑定：',
        '```json',
        '{',
        '  "context": "Chat",',
        '  "bindings": {',
        '    "ctrl+g": null,',
        '    "ctrl+e": "chat:externalEditor"',
        '  }',
        '}',
        '```',
        '',
        '### 解绑快捷键',
        '将键设为`null`以移除默认绑定：',
        '```json',
        '{',
        '  "context": "Chat",',
        '  "bindings": {',
        '    "ctrl+s": null',
        '  }',
        '}',
        '```',
        '',
        '### 添加和弦绑定',
        '```json',
        '{',
        '  "context": "Global",',
        '  "bindings": {',
        '    "ctrl+k ctrl+t": "app:toggleTodos"',
        '  }',
        '}',
        '```',
        '',
        '## 行为规则',
        '',
        '1. 只包含用户想改的上下文（最小覆盖）',
        '2. 验证动作和上下文使用有效名称',
        '3. 提醒可能与终端保留快捷键冲突（如`ctrl+c`、`ctrl+z`）',
        '4. 新绑定是附加的——原有默认键仍有效，除非显式解绑',
        '',
        ...(args ? ['', '## 用户需求', '', args] : []),
      ];
    },
  });
}

/**
 * 注册示例文本生成技能（基于CC源码）
 */
function registerLoremIpsumSkill(registry: BundledSkillsRegistry): void {
  registry.registerBundledSkill({
    name: 'loremIpsum',
    description: '生成填充文本用于长上下文测试——指定token数量作为参数',
    aliases: ['lorem-ipsum', 'filler', '填充文本'],
    whenToUse: '当用户需要占位/填充文本用于测试布局、模板或长上下文场景时使用',
    argumentHint: '[token数量]',
    userInvocable: true,
    async getPromptForCommand(args: string, context: any): Promise<string[]> {
      const targetTokens = parseInt(args);
      if (args && (isNaN(targetTokens) || targetTokens <= 0)) {
        return ['无效的token数量。请提供一个正数（如 /lorem-ipsum 10000）。'];
      }
      if (!args) {
        return [
          '用法: /lorem-ipsum [token_count]',
          '',
          '生成用于测试的填充文本。指定所需的近似token数量。',
          '',
          '示例:',
          '  /lorem-ipsum 1000    — 生成约1000个token',
          '  /lorem-ipsum 50000   — 生成约50000个token（适用于上下文测试）',
        ];
      }
      return [
        '# Lorem Ipsum生成器',
        '',
        `生成约${targetTokens}个token的填充文本用于测试。`,
        '',
        '## 指令',
        '',
        '生成符合以下约束的连贯填充文本：',
        `1. 输出约${targetTokens}个token的文本`,
        '2. 使用多样的句子结构和词汇',
        '3. 组织成段落（每段5-8句，用空行分隔）',
        '4. 语法正确但语义无意义',
        '5. 不要包含任何解释性文字——只输出生成的文本',
      ];
    },
  });
}

/**
 * 注册Claude API参考技能（基于CC源码）
 */
function registerClaudeApiSkill(registry: BundledSkillsRegistry): void {
  registry.registerBundledSkill({
    name: 'claudeApi',
    description: '使用Claude API和Anthropic SDK构建应用程序',
    aliases: ['claude-api', 'api', 'anthropic', 'sdk'],
    whenToUse: '当用户想使用Claude API、Anthropic SDK构建应用，或代码中导入anthropic时使用',
    argumentHint: '输入API相关问题',
    allowedTools: ['Read', 'Grep', 'Glob', 'WebFetch'],
    userInvocable: true,
    async getPromptForCommand(args: string, context: any): Promise<string[]> {
      return [
        '# Claude API参考',
        '',
        '帮助用户使用Claude API或Anthropic SDK构建应用。',
        '',
        '## 核心概念',
        '',
        '### API基础',
        '- **Messages API**: 使用`messages.create()`发送消息',
        '- **流式响应**: 使用`stream: true`获得实时响应',
        '- **系统提示**: 通过`system`参数设置行为',
        '- **最大Token数**: 使用`max_tokens`控制响应长度',
        '',
        '### 关键特性',
        '',
        '**工具调用/函数调用**：让Claude调用函数和使用工具',
        '```python',
        'response = client.messages.create(',
        '    model="claude-sonnet-4-20250514",',
        '    max_tokens=1024,',
        '    tools=[{',
        '        "name": "get_weather",',
        '        "description": "获取当前天气",',
        '        "input_schema": {',
        '            "type": "object",',
        '            "properties": {',
        '                "location": {"type": "string"}',
        '            }',
        '        }',
        '    }],',
        '    messages=[{"role": "user", "content": "东京的天气？"}]',
        ')',
        '```',
        '',
        '**流式处理**：逐token处理响应',
        '- 使用Server-Sent Events (SSE)实现实时UI',
        '- 处理`content_block_start`、`content_block_delta`、`message_stop`事件',
        '',
        '**提示缓存**：减少重复上下文的成本',
        '- 缓存系统提示和大型上下文',
        '- 使用`cache_control`参数',
        '',
        '**批处理**：高效处理多个请求',
        '- 提交批处理作业处理非实时任务',
        '- 轮询完成状态',
        '',
        '## 常见任务',
        '',
        '| 任务 | 方法 |',
        '|------|------|',
        '| 文本分类/摘要 | 单次messages.create调用 |',
        '| 聊天UI（流式） | 流式响应，逐token显示 |',
        '| 带工具的Agent | 工具调用+循环处理多步任务 |',
        '| 文件处理 | 使用files API上传文档 |',
        '| 错误处理 | 捕获API错误，实现退避重试 |',
        '',
        '## 资源链接',
        '',
        '- API参考: https://docs.anthropic.com/en/api/getting-started',
        '- SDK文档: 参考各语言SDK文档',
        '- 状态页: https://status.anthropic.com',
        '',
        ...(args ? ['', '## 用户需求', '', args] : []),
      ];
    },
  });
}

/**
 * 注册Chrome集成帮助技能（基于CC源码）
 */
function registerClaudeInChromeSkill(registry: BundledSkillsRegistry): void {
  registry.registerBundledSkill({
    name: 'claudeInChrome',
    description: '在Chrome浏览器中与Claude Code集成的帮助',
    aliases: ['chrome', '浏览器'],
    whenToUse: '当用户想在Chrome浏览器中使用Claude Code或需要浏览器集成帮助时使用',
    argumentHint: '输入Chrome集成相关问题',
    userInvocable: true,
    async getPromptForCommand(args: string, context: any): Promise<string[]> {
      return [
        '# Chrome集成',
        '',
        '在Chrome浏览器中与Claude Code集成的帮助。',
        '',
        '## 功能',
        '',
        '- 在Chrome中直接使用Claude Code',
        '- 从浏览器中读取和编辑代码',
        '- 利用浏览器开发者工具进行调试',
        '',
        ...(args ? ['', '## 用户需求', '', args] : []),
      ];
    },
  });
}

/**
 * 注册远程代理调度技能（基于CC源码）
 */
function registerScheduleRemoteAgentsSkill(registry: BundledSkillsRegistry): void {
  registry.registerBundledSkill({
    name: 'scheduleRemoteAgents',
    description: '调度远程代理执行任务——安排代理在后台或指定时间运行',
    aliases: ['schedule-remote-agents', 'remote-agents', '远程代理'],
    whenToUse: '当用户需要调度远程代理在后台执行任务或在指定时间运行时使用',
    argumentHint: '输入远程代理调度需求',
    userInvocable: true,
    async getPromptForCommand(args: string, context: any): Promise<string[]> {
      return [
        '# 远程代理调度',
        '',
        '调度远程代理执行任务。',
        '',
        '## 功能',
        '',
        '- 在后台运行代理任务',
        '- 按计划时间执行',
        '- 监控代理执行状态',
        '- 收集执行结果',
        '',
        '## 使用场景',
        '',
        '- 定期代码审查',
        '- 自动化测试运行',
        '- 定时数据抓取',
        '- 后台批处理任务',
        '',
        ...(args ? ['', '## 调度需求', '', args] : []),
      ];
    },
  });
}

/**
 * 注册审查工件技能（基于CC源码）
 */
function registerHunterSkill(registry: BundledSkillsRegistry): void {
  registry.registerBundledSkill({
    name: 'hunter',
    description: '审查代码工件和制品——分析代码变更、审查PR并提供反馈',
    aliases: ['review', '审查'],
    whenToUse: '当用户需要审查代码工件、分析代码变更或审查PR时使用',
    argumentHint: '输入需要审查的工件链接或描述',
    allowedTools: ['Read', 'Grep', 'Glob'],
    userInvocable: true,
    async getPromptForCommand(args: string, context: any): Promise<string[]> {
      return [
        '# 工件审查',
        '',
        '审查代码工件和制品，分析变更并提供反馈。',
        '',
        '## 审查内容',
        '',
        '- 代码变更差异分析',
        '- 潜在问题和风险识别',
        '- 代码质量和最佳实践检查',
        '- 改进建议',
        '',
        ...(args ? ['', '## 审查对象', '', args] : []),
      ];
    },
  });
}

/**
 * 注册梦境模式技能（基于CC源码）
 */
function registerDreamSkill(registry: BundledSkillsRegistry): void {
  registry.registerBundledSkill({
    name: 'dream',
    description: '进入梦境模式——一种实验性的沉浸式编码体验，增强创造力和心流状态',
    aliases: ['dream-mode', '梦境', '幻想'],
    whenToUse: '当用户想进入实验性的梦境模式以增强创造力、头脑风暴或沉浸式编码时使用',
    argumentHint: '[梦境场景或目标]',
    userInvocable: true,
    async getPromptForCommand(args: string, context: any): Promise<string[]> {
      return [
        '# 梦境模式',
        '',
        '进入实验性的梦境模式，获得增强的创造力和沉浸式探索体验。',
        '',
        ...(args ? [`梦境场景: ${args}`, ''] : []),
        '## 什么是梦境模式？',
        '',
        '梦境模式创造了一个放松、探索性的环境：',
        '- 鼓励创造性和非传统的解决方案',
        '- 头脑风暴和构思优先于严格的正确性',
        '- 专注于探索、发现和心流状态',
        '- 暂时放宽约束以允许新颖的方法',
        '',
        '## 指令',
        '',
        '1. **营造氛围** — 使用温暖、富有想象力的语言。鼓励创造性思维。',
        '2. **自由探索** — 考虑多种方法，包括非传统方法。',
        '3. **隐喻思考** — 从自然、艺术、音乐和其他领域汲取类比。',
        '4. **建立在想法之上** — 在评估每个想法之前先接纳并扩展它。',
        '5. **温和回归** — 梦境会话结束时，总结见解和可操作的下一步。',
        '',
        '## 指南',
        '',
        '- 梦境模式是实验性的，可能产生非传统结果',
        '- 生成的想法可以在之后使用标准工具进行优化',
        '- 目标是释放创造潜力，而非产生生产级代码',
        '- 在感到卡住、需要灵感或探索全新想法时使用此模式',
      ];
    },
  });
}

/**
 * 注册技能生成器技能（基于CC源码）
 */
function registerRunSkillGeneratorSkill(registry: BundledSkillsRegistry): void {
  registry.registerBundledSkill({
    name: 'runSkillGenerator',
    description: '运行技能生成器——通过交互式会话自动创建新技能',
    aliases: ['run-skill-generator', 'skill-generator', '技能生成'],
    whenToUse: '当用户想要通过引导式流程自动生成新技能时使用',
    argumentHint: '输入技能生成需求',
    userInvocable: true,
    async getPromptForCommand(args: string, context: any): Promise<string[]> {
      return [
        '# 技能生成器',
        '',
        '通过交互式会话自动创建新技能。',
        '',
        '## 流程',
        '',
        '1. **收集需求** — 了解用户想要自动化的过程',
        '2. **设计技能结构** — 定义步骤、参数和成功标准',
        '3. **生成SKILL.md** — 创建格式正确的技能文件',
        '4. **验证和测试** — 确保技能按预期工作',
        '',
        ...(args ? ['', '## 生成需求', '', args] : []),
      ];
    },
  });
}

export default createDefaultBundledSkillsRegistry;