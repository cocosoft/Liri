/**
 * 内置技能加载器
 * 加载编程式的内置技能（类似CC源码中的bundled skills）
 */

import { Skill, SkillSource, SkillLoadMethod } from '@modules/skills/types';
import { SkillLoader } from '../SkillLoader';

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
 */
const bundledSkills: BundledSkillDefinition[] = [
  {
    name: 'debug',
    description:
      'Enable debug logging for this session and help diagnose issues',
    allowedTools: ['Read', 'Grep', 'Glob'],
    argumentHint: '[issue description]',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text',
          text: `# Debug Skill

Help the user debug an issue they're encountering in this session.

## Issue Description

${args || 'The user did not describe a specific issue.'}

## Instructions

1. Review the user's issue description
2. Check the debug log for errors and warnings
3. Explain what you found in plain language
4. Suggest concrete fixes or next steps
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
            text: `Usage: /loop [interval] <prompt>

Run a prompt or slash command on a recurring interval.

Intervals: Ns, Nm, Nh, Nd (e.g. 5m, 30m, 2h, 1d). Minimum granularity is 1 minute.
If no interval is specified, defaults to 10m.

Examples:
  /loop 5m /babysit-prs
  /loop 30m check the deploy
  /loop 1h /standup 1
  /loop check the deploy          (defaults to 10m)
  /loop check the deploy every 20m`,
          },
        ];
      }
      return [
        {
          type: 'text',
          text: `# /loop — schedule a recurring prompt

Parse the input below into \`[interval] <prompt…>\`.

## Input

${trimmed}

## Instructions

1. Parse the interval and prompt from the input
2. Schedule the prompt to run on the specified interval
3. Execute the prompt immediately as well`,
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
          text: `# Simplify Skill

Help the user understand and simplify complex code.

## Code to Simplify

${args || 'No code provided.'}

## Instructions

1. Analyze the code structure and logic
2. Simplify complex patterns and reduce boilerplate
3. Explain the simplified version clearly
4. Provide the simplified code with comments`,
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
          text: `# Remember Skill

Store the following information for future reference.

## Information to Remember

${args || 'No information provided.'}

## Instructions

1. Store this information in memory
2. Summarize the key points
3. Confirm to the user that the information has been stored`,
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
          text: `# Verify Skill

Verify code changes and suggest improvements.

## Code to Verify

${args || 'No code provided.'}

## Instructions

1. Review the code for correctness
2. Check for potential bugs and issues
3. Suggest improvements and best practices
4. Provide specific recommendations`,
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
          text: `# Batch Skill

Process multiple files or tasks in batch.

## Batch Operation

${args || 'No operation specified.'}

## Instructions

1. Parse the operation and target files
2. Execute the operation on each file
3. Provide a summary of results`,
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
          text: `# Stuck Skill

Help the user when they feel stuck on a problem.

## Problem Description

${args || 'No problem description provided.'}

## Instructions

1. Understand the user's problem
2. Ask clarifying questions if needed
3. Brainstorm possible approaches
4. Provide actionable suggestions to move forward`,
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
    allowedTools: ['Read'],
    userInvocable: true,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text',
          text: `# Update Config Skill

Modify configuration by updating settings.json files using natural language.

## Settings File Locations

Choose the appropriate file based on scope:

| File | Scope | Use For |
|------|-------|---------|
| \`settings.json\` (user) | Global | Personal preferences for all projects |
| \`.claude/settings.json\` (project) | Project | Team-wide hooks, permissions |
| \`.claude/settings.local.json\` (project local) | Project | Personal overrides for this project |

Settings load in order: user → project → local (later overrides earlier).

## Configuration Sections

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

### Environment Variables
\`\`\`json
{
  "env": {
    "DEBUG": "true",
    "MY_API_KEY": "value"
  }
}
\`\`\`

### Hooks
Hooks run commands at specific lifecycle events:
- \`PreToolUse\` — Before a tool runs
- \`PostToolUse\` — After a successful tool
- \`Stop\` — When Claude stops
- \`SessionStart\` — When a session starts

### Model & Agent
\`\`\`json
{
  "model": "your-model-id",
  "language": "chinese"
}
\`\`\`

## Workflow

1. **Clarify intent** — If ambiguous, ask user which settings file and what to change
2. **Read existing file** — Always read the target file before making changes
3. **Merge carefully** — Preserve existing settings, especially arrays
4. **Edit file** — Use Edit tool to modify, never replace entire file

## Important Rules

- **Always read first** — Never write without reading existing content
- **Merge arrays** — Add to existing arrays, never replace them
- **Ask when ambiguous** — Use AskUserQuestion to clarify scope and values

${args ? `\n## User Request\n\n${args}` : ''}`,
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
    allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'AskUserQuestion'],
    userInvocable: true,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text',
          text: `# Skillify — Capture Process as Skill

Capture a repeatable process from this session into a reusable SKILL.md skill file.

${args ? `The user described this process as: "${args}"\n\n` : ''}

## Your Task

### Step 1: Analyze the Session

Before asking questions, identify:
- What repeatable process was performed
- What the inputs/parameters were
- The distinct steps (in order)
- The success criteria for each step
- What tools and permissions were needed

### Step 2: Interview the User

Use AskUserQuestion to understand:
- **Round 1**: Suggest a name and description for the skill. Ask for confirmation.
- **Round 2**: Present high-level steps. Ask about arguments and where to save.
- **Round 3**: Break down each step with success criteria.

### Step 3: Write the SKILL.md

Use this format:
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

### Step 4: Save and Confirm

Before writing, output the SKILL.md content for review. Ask user to confirm using AskUserQuestion.`,
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
    allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'AskUserQuestion'],
    userInvocable: true,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text',
          text: `# Skill Creator

Guidance for creating and maintaining effective skills in Liri.

${args ? `Target skill: "${args}"\n\n` : ''}

## Liri Skill Model (must respect)

- Skills are **prompt-instruction templates** injected into the LLM context. They are NOT executable code.
- **Shell execution is permanently disabled** in Liri. Never reference or require running shell/Python scripts inside a skill.
- Built-in skills are programmatic definitions in BundledSkillLoader; user skills live at \`~/.pyapp/skills/<name>/SKILL.md\`; third-party skills at \`~/.pyapp/skills/vendor/\`.
- Skills created for the user go to \`~/.pyapp/skills/<name>/SKILL.md\` (auto-registered on write, no restart needed).

## Core Principles

1. **Concise is key.** The context window is a shared resource. Only add context the model doesn't already have; challenge each paragraph for token cost. Prefer concise examples over verbose explanations.
2. **Set appropriate degrees of freedom.** Text-based instructions (high freedom) for heuristic tasks; specific scripts/sequences (low freedom) only for fragile operations. Liri skills are text-based by design.
3. **Progressive disclosure.** Metadata (name + description) is always in context; SKILL.md body loads on trigger (<500 lines); references/assets load only when needed. Keep SKILL.md lean; split variant details into referenced files.

## Skill Anatomy

\`\`\`
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name + description — these are the ONLY trigger fields)
│   └── Markdown instructions (loaded only AFTER the skill triggers)
├── references/  (optional) docs loaded into context as needed
└── assets/      (optional) files used in output
\`\`\`

Do NOT include extraneous files (README.md, CHANGELOG.md, INSTALLATION_GUIDE.md, etc.) inside a skill.

## Naming

- Lowercase letters, digits, hyphens only; normalize titles to hyphen-case ("Plan Mode" → \`plan-mode\`).
- Keep names under 64 chars; prefer short, verb-led phrases.
- Name the skill folder exactly after the skill name.

## Creating a Skill (workflow)

1. **Understand with concrete examples**: clarify the functionality and its trigger scenarios with the user (AskUserQuestion, few questions at a time).
2. **Plan reusable contents**: decide which scripts/references/assets would help. In Liri, omit shell/Python scripts (shell is disabled); prefer references/ for structured knowledge.
3. **Initialize**: create \`~/.pyapp/skills/<name>/SKILL.md\` with a template.
4. **Write SKILL.md** (imperative mood):
   - Frontmatter: \`name\` and \`description\` only. The \`description\` is the primary trigger — include BOTH what the skill does AND specific when-to-use triggers/contexts. All "when to use" info belongs in the description, NOT the body.
   - Body: procedural instructions, steps with success criteria, references to bundled resources. Keep under 500 lines.
5. **Save and verify**: write the file (auto-registered), verify the listing shows it, and iterate based on real usage.

## Reviewing / Improving an Existing Skill

- Audit the frontmatter \`description\`: does it cover trigger contexts? Is it one clear line?
- Check the body for stale steps, duplicated references, or bloat; restructure with progressive disclosure.
- Ensure no shell/Python execution is required (Liri constraint).`,
        },
      ];
    },
  },
];

/**
 * 内置技能加载器
 */
export class BundledSkillLoader extends SkillLoader {
  async loadSkills(): Promise<Skill[]> {
    return bundledSkills.map(
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
  }

  getSource(): SkillSource {
    return SkillSource.BUILTIN;
  }
}
