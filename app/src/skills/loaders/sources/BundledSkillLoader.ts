/**
 * 内置技能加载器
 * 加载编程式的内置技能（类似CC源码中的bundled skills）
 */

import { Skill, SkillSource, SkillLoadMethod } from '@modules/skills/types';
import { SkillLoader } from '../SkillLoader';
import {
  SkillProvider,
  SkillCandidate,
  PROVIDER_RANK,
  toCandidates,
} from '../SkillProvider';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('skills:bundledLoader');

/**
 * 内置技能定义
 */
interface BundledSkillDefinition {
  name: string;
  description: string;
  aliases?: string[];
  whenToUse?: string;
  argumentHint?: string;
  allowedTools?: string[];
  userInvocable?: boolean;
  getPromptForCommand: (
    args: string,
    context: unknown
  ) => Promise<{ type: string; text: string }[]>;
}

/**
 * 内置技能列表（从CC源码移植）
 *
 * ⚠️ **`allowedTools` 必须写本仓的"真实注册名"**（2026-09-29，台账 **D-44**）：该字段会经
 * `commands/builtin/skill/index.ts`（中文）与 `skills/cli/skills.ts`（英文）**显示给用户**
 * （"允许的工具: …"）⇒ 写成 CC 名（`Read`/`Write`/`Edit`/`Grep`/`Glob`/`AskUserQuestion`）
 * 会让用户看到**本仓不存在**的工具名（`file_search` 同族漂移）。
 * 事实源 = 生成物 `constants/toolNames.generated.ts`；守卫见 `tests/skills/SkillProvider.test.ts`
 * 的「内置技能 allowedTools ⊆ 真实注册名」用例。
 */
const bundledSkills: BundledSkillDefinition[] = [
  {
    name: 'debug',
    description:
      'Enable debug logging for this session and help diagnose issues',
    allowedTools: ['file_read', 'grep', 'glob'],
    argumentHint: '[issue description]',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text',
          text: `# 调试技能

帮助用户调试他们在本次会话中遇到的问题。

## 问题描述

${args || '用户未描述具体问题。'}

## 操作说明

1. 阅读用户的问题描述
2. 检查调试日志中的错误与警告
3. 用通俗语言解释你的发现
4. 给出具体的修复建议或后续步骤
`,
        },
      ];
    },
  },
  {
    name: 'loop',
    description:
      'Run a prompt or slash command on a recurring interval (e.g. /loop 5m /foo)',
    whenToUse:
      'When the user wants to set up a recurring task, poll for status, or run something repeatedly on an interval',
    argumentHint: '[interval] <prompt>',
    userInvocable: true,
    async getPromptForCommand(args) {
      const trimmed = args.trim();
      if (!trimmed) {
        return [
          {
            type: 'text',
            text: `用法：/loop [interval] <prompt>

按固定间隔重复运行提示词或斜杠命令。

间隔：Ns, Nm, Nh, Nd（如 5m, 30m, 2h, 1d）。最小粒度为 1 分钟。
未指定间隔时，默认为 10m。

示例：
  /loop 5m /babysit-prs
  /loop 30m check the deploy
  /loop 1h /standup 1
  /loop check the deploy          (默认为 10m)
  /loop check the deploy every 20m`,
          },
        ];
      }
      return [
        {
          type: 'text',
          text: `# /loop — 调度周期性提示词

将下方输入解析为 \`[interval] <prompt…>\`。

## 输入

${trimmed}

## 操作说明

1. 从输入中解析出间隔与提示词
2. 按指定间隔调度该提示词运行
3. 同时立即执行一次该提示词`,
        },
      ];
    },
  },
  {
    name: 'simplify',
    description: 'Simplify and explain complex code',
    whenToUse: 'When the user wants to understand or simplify complex code',
    argumentHint: '<code or code description>',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text',
          text: `# 简化技能

帮助用户理解并简化复杂代码。

## 待简化的代码

${args || '未提供代码。'}

## 操作说明

1. 分析代码结构与逻辑
2. 简化复杂模式，减少样板代码
3. 清晰地解释简化后的版本
4. 给出带注释的简化代码`,
        },
      ];
    },
  },
  {
    name: 'remember',
    description: 'Remember information for later reference',
    whenToUse: 'When the user wants to store information for future reference',
    argumentHint: '<information to remember>',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text',
          text: `# 记忆技能

保存以下信息以备后续参考。

## 待记忆的信息

${args || '未提供信息。'}

## 操作说明

1. 将该信息存入记忆
2. 总结要点
3. 向用户确认信息已保存`,
        },
      ];
    },
  },
  {
    name: 'verify',
    description: 'Verify code changes and suggest improvements',
    whenToUse:
      'When the user wants to verify code correctness or get improvement suggestions',
    argumentHint: '<code or file path>',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text',
          text: `# 验证技能

验证代码改动并给出改进建议。

## 待验证的代码

${args || '未提供代码。'}

## 操作说明

1. 检查代码是否正确
2. 检查潜在的缺陷与问题
3. 给出改进建议与最佳实践
4. 给出具体的建议`,
        },
      ];
    },
  },
  {
    name: 'batch',
    description: 'Process multiple files or tasks in batch',
    whenToUse:
      'When the user wants to perform the same operation on multiple files',
    argumentHint: '<operation> <files>',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text',
          text: `# 批处理技能

批量处理多个文件或任务。

## 批处理操作

${args || '未指定操作。'}

## 操作说明

1. 解析操作与目标文件
2. 对每个文件执行该操作
3. 给出结果汇总`,
        },
      ];
    },
  },
  {
    name: 'stuck',
    description: 'Help when you feel stuck on a problem',
    whenToUse: 'When the user is stuck and needs help getting unstuck',
    argumentHint: '<problem description>',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text',
          text: `# 卡壳技能

在用户对某个问题感到卡壳时提供帮助。

## 问题描述

${args || '未提供问题描述。'}

## 操作说明

1. 理解用户的问题
2. 如有需要，提出澄清性问题
3. 头脑风暴可能的思路
4. 给出可落地的推进建议`,
        },
      ];
    },
  },
  {
    name: 'update-config',
    description:
      'Use natural language to manage settings.json configuration — permissions, environment variables, hooks, and more',
    aliases: ['config', 'settings', '配置'],
    whenToUse:
      'When the user wants to configure settings, permissions, hooks, or environment variables using natural language',
    argumentHint: '<configuration request>',
    allowedTools: ['file_read'],
    userInvocable: true,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text',
          text: `# 更新配置技能

通过自然语言修改 Liri 的设置来调整配置。

## 设置文件位置

Liri 的设置有多个来源与文件，按优先级（后者覆盖前者）加载：

| 来源 | 文件 | 用途 |
|------|------|------|
| 用户设置 | \`~/.pyapp/settings.json\` | 所有项目的个人偏好（主题、语言、字号等） |
| 项目设置 | \`{项目根}/app/settings.json\` | 团队共享的项目配置 |
| 本地设置 | \`~/.pyapp/settings.local.json\` | 仅本机的个人覆盖 |
| 应用主配置 | \`~/.pyapp/config.json\` | 应用级配置：模型、权限、通道、功能开关等 |

选择原则：个人偏好改用户设置；团队共享改项目设置；只影响本机改本地设置；应用级配置（模型 / 权限 / 通道 / 功能开关）改 \`~/.pyapp/config.json\`。

（权限的 \`allow\` / \`deny\` / \`ask\` 数组写在上述 settings 文件的 \`permissions\` 段；工具级规则见下方「Permissions」。）

## 配置区块

### Permissions（Liri 权限体系速查表）

Liri 的权限体系有三个来源，按层级参与决策：

| 体系 | 文件/入口 | 规则形态 | 生效时机 |
|------|-----------|---------|---------|
| A 工具级规则 | \`~/.pyapp/data/permissions/tool_rules.json\` | \`{behavior: allow\|deny\|ask, toolName, contentPattern?}\` | 每次工具调用（决策主链路） |
| B 命令级黑白名单 | 设置→自定义规则（配置 \`permission.customRules.commandRules\`） | \`{blacklist[], whitelist[], mode: blacklist\|whitelist}\` | bash/shell/command 命令内容级；黑名单命中 deny；whitelist 模式命中 allow（免审批）、未命中 deny |
| 审批放行缓存 | ApprovedCommandRegistry（内存，session 隔离） | 批准时写入 \`{sessionId, commandHash, baseCommand}\`，TTL 默认 5 分钟（\`PERMISSION_APPROVAL_TTL_MS\`） | 批准后同命令重发不再弹审批；危险命令（rm/del/format/sudo 等）必须精确 hash 匹配 |

#### 常见权限排障路径

- 「bash 每次都弹审批卡」→ 检查 \`tool_rules.json\` 是否堆积重复 ask 规则（启动时自动去重），或在 B 体系 whitelist 加入该命令（免审批）
- 「想关闭某个工具的审批」→ 在 A 体系写 \`{behavior: "allow", toolName: "<tool>"}\`，或在 B 体系 whitelist 加入命令
- 「批准后命令没执行」→ 放行缓存 TTL 内（5 分钟）重发同命令即放行；批准后系统自动续跑（P2-1）
- 「黑名单不生效」→ 确认 B 体系 mode 为 \`blacklist\` 且 pattern 与命令文本匹配

### 环境变量
环境变量由项目根的 \`app/.env\` 文件或操作系统环境变量提供（修改后需重启应用生效）。

### 钩子
钩子配置**不在** \`~/.pyapp/config.json\` 中，而是独立的钩子配置文件（由 hooks 子命令读写）。本仓实际支持的事件名（点号风格）：
- \`tool.pre-use\` / \`tool.post-use\`
- \`session.start\` / \`session.end\`
- \`file.pre-write\` / \`file.post-write\`
- \`command.pre-execute\` / \`command.post-execute\`
- 其它：\`system.startup\` / \`system.shutdown\` / \`skill.pre-execute\` / \`http.pre-request\` / \`cost.alert\` 等（完整清单见 \`hooks/types/index.ts\` 的 \`HookEvent\`）

单条钩子的类型为 \`command\` / \`prompt\` / \`http\` / \`agent\`。

### 模型与语言
- 模型：\`~/.pyapp/config.json\` 的 \`ai.model\`（当前对话模型）；任务分工为 \`models.current\` / \`models.tasks\`
- 语言：\`~/.pyapp/settings.json\` 的 \`language\`

## 工作流

1. **明确意图** — 若有歧义，询问用户要改哪个设置文件以及要改什么
2. **读取现有文件** — 修改前总是先读取目标文件
3. **谨慎合并** — 保留现有设置，尤其是数组
4. **编辑文件** — 使用 Edit 工具修改，绝不整体替换文件

## 重要规则

- **总是先读** — 未读取现有内容绝不写入
- **合并数组** — 向现有数组追加，绝不替换
- **有歧义就询问** — 使用 AskUserQuestion 澄清范围与取值

${args ? `\n## 用户请求\n\n${args}` : ''}`,
        },
      ];
    },
  },
  {
    name: 'skillify',
    description:
      'Capture a repeatable process from this session into a reusable skill',
    aliases: ['capture', 'makeskill', '创建技能'],
    whenToUse:
      'When the user has performed a repeatable process and wants to save it as a reusable skill',
    argumentHint: '[description of the process to capture]',
    allowedTools: [
      'file_read',
      'file_write',
      'file_edit',
      'glob',
      'grep',
      'ask_user_question',
    ],
    userInvocable: true,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text',
          text: `# Skillify — 将流程沉淀为技能

将本次会话中的可复用流程沉淀为一个可复用的 SKILL.md 技能文件。

${args ? `用户将该流程描述为："${args}"\n\n` : ''}

## 你的任务

### 第 1 步：分析本次会话

在提问之前，先识别：
- 执行了什么可复用的流程
- 输入/参数是什么
- 各个具体步骤（按顺序）
- 每个步骤的成功标准
- 需要用到哪些工具与权限

### 第 2 步：访谈用户

使用 AskUserQuestion 了解：
- **第 1 轮**：为技能建议一个名称与描述，请用户确认。
- **第 2 轮**：给出高层步骤，询问参数以及保存位置。
- **第 3 轮**：拆分每个步骤并附上成功标准。

### 第 3 步：编写 SKILL.md

使用以下格式：
\`\`\`markdown
---
name: {{skill-name}}
description: {{one-line description}}
allowed-tools:
  {{tool permission patterns}}
when_to_use: {{when to auto-invoke}}
argument-hint: "{{hint}}"
arguments:
  {{argument names}}
context: {{inline or fork}}
---

# {{Skill Title}}

## Inputs
- \`$arg_name\`: Description

## Goal
Clearly stated goal and completion criteria.

## Steps

### 1. Step Name
What to do in this step.

**Success criteria**: How to know this step is done.
\`\`\`

### 第 4 步：保存并确认

写入之前，先输出 SKILL.md 内容供审阅，并使用 AskUserQuestion 请用户确认。`,
        },
      ];
    },
  },
  {
    name: 'skill-creator',
    description:
      'Create, edit, improve, tidy, review, audit, or restructure SKILL.md files following proven skill design methodology',
    aliases: ['create-skill', '技能方法论'],
    whenToUse:
      'When the user wants to create, edit, improve, review, or restructure a skill (SKILL.md), or wants guidance on how to design a well-structured skill',
    argumentHint: '[skill name or description]',
    allowedTools: [
      'file_read',
      'file_write',
      'file_edit',
      'glob',
      'grep',
      'ask_user_question',
    ],
    userInvocable: true,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text',
          text: `# 技能创建器

在 Liri 中创建与维护高效技能的指导。

${args ? `目标技能："${args}"\n\n` : ''}

## Liri 技能模型（必须遵守）

- 技能是注入到 LLM 上下文中的**提示词指令模板**，不是可执行代码。
- Liri 中**已永久禁用 shell 执行**。绝不要在技能中引用或要求运行 shell/Python 脚本。
- 内置技能是 BundledSkillLoader 中的编程式定义；用户技能位于 \`~/.pyapp/skills/<name>/SKILL.md\`；第三方技能位于 \`~/.pyapp/skills/vendor/\`。
- 为用户创建的技能写入 \`~/.pyapp/skills/<name>/SKILL.md\`（写入即自动注册，无需重启）。

## 核心原则

1. **简洁是关键。** 上下文窗口是共享资源。只添加模型尚不具备的上下文；对每一段的 token 成本都要提出质疑。优先用简洁示例，而非冗长解释。
2. **设置恰当的自由度。** 启发式任务用文本式指令（高自由度）；仅对脆弱操作才使用具体脚本/步骤序列（低自由度）。Liri 技能在设计上就是文本式的。
3. **渐进式披露。** 元数据（name + description）始终在上下文中；SKILL.md 正文在触发时加载（<500 行）；references/assets 仅在需要时加载。保持 SKILL.md 精简，把变体细节拆分到被引用的文件中。

## 技能结构

\`\`\`
skill-name/
├── SKILL.md（必需）
│   ├── YAML frontmatter（name + description —— 这两个是唯一的触发字段）
│   └── Markdown 指令（仅在技能触发之后才加载）
├── references/  （可选）按需加载进上下文的文档
└── assets/      （可选）用于产出的文件
\`\`\`

不要在技能内包含无关文件（README.md、CHANGELOG.md、INSTALLATION_GUIDE.md 等）。

## 命名

- 只能使用小写字母、数字与连字符；将标题归一化为连字符风格（"Plan Mode" → \`plan-mode\`）。
- 名称保持在 64 字符以内；优先简短、以动词开头的短语。
- 技能文件夹名必须与技能名完全一致。

## 创建技能（工作流）

1. **结合具体示例理解需求**：与用户一起厘清功能及其触发场景（使用 AskUserQuestion，每次只问少量问题）。
2. **规划可复用内容**：确定哪些脚本/references/assets 会有帮助。在 Liri 中省略 shell/Python 脚本（shell 已禁用）；优先用 references/ 存放结构化知识。
3. **初始化**：用模板创建 \`~/.pyapp/skills/<name>/SKILL.md\`。
4. **编写 SKILL.md**（祈使语气）：
   - Frontmatter：只写 \`name\` 与 \`description\`。\`description\` 是主要触发依据 —— 必须**同时**包含技能做什么以及具体的何时使用触发条件/场景。所有"何时使用"的信息都属于 description，而不是正文。
   - 正文：过程式指令、带成功标准的步骤、对随附资源的引用。保持在 500 行以内。
5. **保存并验证**：写入文件（自动注册），确认列表中能看到它，并根据真实使用情况迭代。

## 审查 / 改进现有技能

- 审查 frontmatter 中的 \`description\`：是否覆盖了触发场景？是否是一行清晰的描述？
- 检查正文是否有过时步骤、重复引用或冗余；用渐进式披露重新组织。
- 确保不需要执行 shell/Python（Liri 的约束）。`,
        },
      ];
    },
  },
  {
    name: 'doc-workflow',
    description:
      '分阶段生成图文混编文档（周报/PPT/方案/纪要）。按「大纲→内容+配图→成稿」三阶段执行，支持 docx/pptx/html/pdf。触发词：做份周报/做份PPT/生成方案/写文档/做报告。Generate documents in stages: outline → content+images → compose.',
    aliases: ['做文档', '做报告', '做PPT', '做周报', '生成文档'],
    whenToUse:
      '用户要求生成图文混编文档时使用，特别是周报、PPT、方案、会议纪要等职场场景。当用户说"做份周报"、"做份PPT"、"生成方案"时触发。',
    allowedTools: ['doc_generate', 'image_generate', 'ask_user_question'],
    argumentHint: '[文档主题和格式]',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text',
          text: `# 分阶段文档工作流

用户请求：${args || '（未指定主题，请先询问）'}

## 执行流程

### 阶段①：大纲整理
1. 分析用户需求，确定文档格式（docx/pptx/html/pdf）和主题
2. 生成结构化大纲：
   - 每个节点包含：id、kind（section/slide/chart/text）、title、bullets、imageHint
   - PPT 格式额外约束：
     * 标题 ≤6 字（可配置 4-8）
     * 要点 ≤3 条（可配置 2-4）
     * 每页应标注是否配图 + 意图描述
     * 正文为提炼后语言（主语+动作+结果），非原文平铺
3. **必须等待用户确认大纲**后才进入阶段②
4. 用户可修改大纲，修改后仅对变更节点增量填充

### 阶段②：内容填充 + 配图
1. 逐节点填充正文内容
2. 含 imageHint 的节点生成图片占位符：\`![描述](GENERATE:id=img-1;prompt=提示词)\`
3. 调用 image_generate 生成图片（同 id 只生成一次，多节点复用）
4. 图片生成失败时降级：保留占位符，人工插图
5. **图片需求可批量确认**，确认后批量生成

### 阶段③：成稿
1. 替换所有图片占位符为实际 filePath
2. 调用 doc_generate 生成最终文档
3. 返回文件路径

## PPT 精炼规则（仅 pptx 格式）
- 标题精炼：每页标题 ≤6 字，不是截断而是改写
- 要点精炼：每页 ≤3 条要点，每条为主语+动作+结果结构
- 配图意图：≥80% 页面标注配图意图
- 正文提炼：改写为演讲语言，非原文平铺
- 排版约束：16:9 比例，标题区/正文区/配图区分区

## 场景模板
- weekly-report：周报模板
- meeting-minutes：会议纪要模板
- tech-design：技术方案模板
- prd：产品需求文档模板

## 注意事项
- 流程级确认（大纲/图片）由本技能内部管理，不经过 DecisionGate
- 图片生成并发度建议 3-4，受 provider 速率限制
- 文件输出到 ~/.pyapp/output/ 目录`,
        },
      ];
    },
  },
];

/**
 * 内置技能加载器
 */
export class BundledSkillLoader extends SkillLoader implements SkillProvider {
  readonly name = 'bundled';

  /**
   * 列出内置技能候选（locator = Skill 本体）
   */
  async list(): Promise<SkillCandidate[]> {
    return toCandidates(await this.loadSkills(), PROVIDER_RANK.BUILTIN);
  }

  /**
   * 按候选返回完整技能（当前全量加载，直接返回 locator）
   */
  get(candidate: SkillCandidate): Promise<Skill | undefined> {
    return Promise.resolve(candidate.locator as Skill);
  }

  /** 无内部缓存，预留契约 */
  invalidate(): void {
    // 当前加载器无缓存，无需失效
  }

  async loadSkills(): Promise<Skill[]> {
    const loaded = bundledSkills.map(
      (def): Skill => ({
        name: def.name,
        description: def.description,
        aliases: def.aliases,
        allowedTools: def.allowedTools || [],
        argumentHint: def.argumentHint,
        whenToUse: def.whenToUse,
        userInvocable: def.userInvocable ?? true,
        disableModelInvocation: false,
        contentLength: 0,
        progressMessage: '',
        source: SkillSource.BUILTIN,
        loadMethod: SkillLoadMethod.EMBEDDED,
        loadedFrom: 'bundled',
        isHidden: !(def.userInvocable ?? true),
        impl: {
          kind: 'prompt',
          getPromptForCommand: (args: unknown, toolUseContext: unknown) =>
            def.getPromptForCommand(args as string, toolUseContext),
        },
      })
    );
    logger.info('BundledSkillLoader.loadSkills', { count: loaded.length });
    return loaded;
  }

  getSource(): SkillSource {
    return SkillSource.BUILTIN;
  }
}
