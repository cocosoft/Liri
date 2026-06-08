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
    context: any
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

### Permissions
\`\`\`json
{
  "permissions": {
    "allow": ["Bash(npm:*)", "Read"],
    "deny": ["Bash(rm -rf:*)"],
    "ask": ["Write(/etc/*)"],
    "defaultMode": "default" | "plan" | "acceptEdits"
  }
}
\`\`\`

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
  "model": "sonnet",
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
    name: 'keybindings-help',
    description: 'Help with customizing keyboard shortcuts and key bindings',
    aliases: ['keybindings', 'shortcuts', '快捷键'],
    whenToUse:
      'When the user wants to customize keyboard shortcuts, rebind keys, or modify keybindings configuration',
    argumentHint: '<shortcut customization request>',
    allowedTools: ['Read'],
    userInvocable: true,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text',
          text: `# Keybindings Help

Create or modify keybindings configuration to customize keyboard shortcuts.

## CRITICAL: Read Before Write

Always read the existing keybindings file first. Merge changes with existing bindings — never replace the entire file.

## File Format

\`\`\`json
{
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "ctrl+e": "chat:externalEditor"
      }
    }
  ]
}
\`\`\`

## Keystroke Syntax

**Modifiers** (combine with \`+\`):
- \`ctrl\` (alias: \`control\`)
- \`alt\` (aliases: \`opt\`, \`option\`)
- \`shift\`
- \`meta\` (aliases: \`cmd\`, \`command\`)

**Special keys**: \`escape\`/\`esc\`, \`enter\`/\`return\`, \`tab\`, \`space\`, \`backspace\`, \`delete\`, \`up\`, \`down\`, \`left\`, \`right\`

**Chords**: Space-separated keystrokes, e.g. \`ctrl+k ctrl+s\`

**Examples**: \`ctrl+shift+p\`, \`alt+enter\`, \`ctrl+k ctrl+n\`

## Common Patterns

### Rebind a key
Unbind the old key and add the new binding:
\`\`\`json
{
  "context": "Chat",
  "bindings": {
    "ctrl+g": null,
    "ctrl+e": "chat:externalEditor"
  }
}
\`\`\`

### Unbind a shortcut
Set a key to \`null\` to remove its default binding:
\`\`\`json
{
  "context": "Chat",
  "bindings": {
    "ctrl+s": null
  }
}
\`\`\`

### Add a chord binding
\`\`\`json
{
  "context": "Global",
  "bindings": {
    "ctrl+k ctrl+t": "app:toggleTodos"
  }
}
\`\`\`

## Behavioral Rules

1. Only include contexts the user wants to change (minimal overrides)
2. Validate that actions and contexts use valid names
3. Warn about conflicts with terminal reserved shortcuts (e.g. \`ctrl+c\`, \`ctrl+z\`)
4. When adding a new binding for an existing action, the new binding is additive (existing default still works unless explicitly unbound)

${args ? `\n## User Request\n\n${args}` : ''}`,
        },
      ];
    },
  },
  {
    name: 'lorem-ipsum',
    description:
      'Generate filler text for testing — specify token count as argument',
    aliases: ['lorem', 'filler', '填充文本'],
    whenToUse:
      'When the user needs placeholder/filler text for testing layouts, templates, or long context scenarios',
    argumentHint: '[token_count]',
    userInvocable: true,
    async getPromptForCommand(args) {
      const targetTokens = parseInt(args);
      if (args && (isNaN(targetTokens) || targetTokens <= 0)) {
        return [
          {
            type: 'text',
            text: 'Invalid token count. Please provide a positive number (e.g., /lorem-ipsum 10000).',
          },
        ];
      }
      if (!args) {
        return [
          {
            type: 'text',
            text: `Usage: /lorem-ipsum [token_count]

Generate filler text for testing. Specify the approximate number of tokens needed.

Examples:
  /lorem-ipsum 1000    — generates ~1000 tokens
  /lorem-ipsum 50000   — generates ~50000 tokens (good for context testing)`,
          },
        ];
      }
      return [
        {
          type: 'text',
          text: `# Lorem Ipsum Generator

Generate approximately ${targetTokens} tokens of filler text for testing.

## Instructions

Generate coherent filler text with the following constraints:
1. Output approximately ${targetTokens} tokens of text
2. Use a mix of sentence structures and vocabulary
3. Organize into paragraphs (5-8 sentences each, separated by blank lines)
4. The text should be grammatically correct but semantically meaningless
5. Do not include any explanatory text — only output the generated text`,
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
    name: 'claude-api',
    description: 'Build applications with the Claude API and Anthropic SDKs',
    aliases: ['api', 'anthropic', 'sdk'],
    whenToUse:
      'When the user wants to build apps using the Claude API, Anthropic SDKs, or when code imports anthropic/ claude_agent_sdk',
    argumentHint: '<question about Claude API or SDK usage>',
    allowedTools: ['Read', 'Grep', 'Glob', 'WebFetch'],
    userInvocable: true,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text',
          text: `# Claude API Skill

Help the user build applications with the Claude API or Anthropic SDK.

## Core Concepts

### API Basics
- **Messages API**: Send messages with \`messages.create()\`
- **Streaming**: Use \`stream: true\` for real-time responses
- **System Prompts**: Set behavior via \`system\` parameter
- **Max Tokens**: Control response length with \`max_tokens\`

### Key Features

**Tool Use / Function Calling**: Let Claude call functions and use tools
\`\`\`python
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    tools=[{
        "name": "get_weather",
        "description": "Get current weather",
        "input_schema": {
            "type": "object",
            "properties": {
                "location": {"type": "string"}
            }
        }
    }],
    messages=[{"role": "user", "content": "Weather in Tokyo?"}]
)
\`\`\`

**Streaming**: Process responses token by token
- Use Server-Sent Events (SSE) for real-time UI
- Handle \`content_block_start\`, \`content_block_delta\`, \`message_stop\` events

**Prompt Caching**: Reduce costs for repeated context
- Cache system prompts and large context
- Use \`cache_control\` parameter

**Batch Processing**: Process multiple requests efficiently
- Submit batch jobs for non-real-time tasks
- Poll for completion

## Common Tasks

| Task | Approach |
|------|----------|
| Text classification/summarization | Single messages.create call |
| Chat UI with streaming | Stream response, display tokens incrementally |
| Agent with tools | Use tool use + loop for multi-step tasks |
| File processing | Use files API for document uploads |
| Error handling | Catch API errors, implement retry with backoff |

## Resource Links

- API Reference: https://docs.anthropic.com/en/api/getting-started
- SDK Documentation: Refer to the language-specific SDK docs
- Status: https://status.anthropic.com

${args ? `\n## User Request\n\n${args}` : ''}`,
        },
      ];
    },
  },
  {
    name: 'dream',
    description:
      'Enter dream mode — an experimental immersive coding experience with enhanced creativity and flow',
    aliases: ['梦境', 'dream-mode'],
    whenToUse:
      'When the user wants to enter an experimental dream mode for enhanced creativity, brainstorming, or immersive coding sessions',
    argumentHint: '[dream scenario or goal]',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text',
          text: `# Dream Mode

Enter an experimental dream mode for enhanced creativity and immersive exploration.

## What is Dream Mode?

Dream mode creates a relaxed, exploratory environment where:
- Creative and unconventional solutions are encouraged
- Brainstorming and ideation take priority over strict correctness
- The focus is on exploration, discovery, and flow state
- Constraints are temporarily loosened to allow novel approaches

## Instructions

${args ? `Dream Scenario: ${args}\n\n` : ''}1. **Set the atmosphere** — Use warm, imaginative language. Encourage creative thinking.
2. **Explore freely** — Consider multiple approaches, including unconventional ones.
3. **Think in metaphors** — Draw analogies from nature, art, music, and other domains.
4. **Build on ideas** — Yes-and each idea before evaluating it.
5. **Return gently** — When the dream session ends, summarize insights and actionable next steps.

## Guidelines

- Dream mode is experimental and may produce unconventional results
- Ideas generated can be refined later with standard tools
- The goal is to unlock creative potential, not to produce production-ready code
- Use this mode when feeling stuck, needing inspiration, or exploring greenfield ideas`,
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
          getPromptForCommand: def.getPromptForCommand,
        },
      })
    );
  }

  getSource(): SkillSource {
    return SkillSource.BUILTIN;
  }
}
