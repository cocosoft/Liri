/**
 * SkillTool常量定义
 */

/**
 * SkillTool名称
 */
export const SKILL_TOOL_NAME = 'Skill';

/**
 * Skill搜索提示
 */
export const SKILL_SEARCH_HINT = 'run skill custom command';

/**
 * Skill描述
 */
export const SKILL_DESCRIPTION = `Execute a registered skill. Skills are reusable prompt templates or commands that can be invoked by name.`;

/**
 * 内置Skill定义
 */
export const BUILTIN_SKILLS = {
  debug: {
    name: 'debug',
    description: 'Debug issues and diagnose problems in the current session',
    type: 'prompt' as const,
    source: 'builtin' as const,
    enabled: true,
    tags: ['debugging', 'diagnosis', 'troubleshooting'],
    allowedTools: ['Read', 'Grep', 'Glob'],
  },
  verify: {
    name: 'verify',
    description: 'Verify code changes and validate results',
    type: 'agent' as const,
    source: 'builtin' as const,
    enabled: true,
    tags: ['verification', 'validation', 'testing'],
  },
  loop: {
    name: 'loop',
    description: 'Create a loop that repeats actions until a condition is met',
    type: 'agent' as const,
    source: 'builtin' as const,
    enabled: true,
    tags: ['control', 'repeat', 'iteration'],
  },
  stuck: {
    name: 'stuck',
    description:
      'Help when stuck - provides alternative approaches and suggestions',
    type: 'prompt' as const,
    source: 'builtin' as const,
    enabled: true,
    tags: ['help', 'stuck', 'alternative', 'suggestions'],
  },
  batch: {
    name: 'batch',
    description: 'Perform batch operations on multiple files',
    type: 'agent' as const,
    source: 'builtin' as const,
    enabled: true,
    tags: ['batch', 'multiple', 'files'],
  },
  analyze: {
    name: 'analyze',
    description: 'Analyze code quality, complexity, and patterns',
    type: 'prompt' as const,
    source: 'builtin' as const,
    enabled: true,
    tags: ['analysis', 'code quality', 'patterns'],
  },
  optimize: {
    name: 'optimize',
    description: 'Optimize code for performance and efficiency',
    type: 'agent' as const,
    source: 'builtin' as const,
    enabled: true,
    tags: ['optimization', 'performance', 'efficiency'],
  },
  document: {
    name: 'document',
    description: 'Generate documentation for code',
    type: 'agent' as const,
    source: 'builtin' as const,
    enabled: true,
    tags: ['documentation', 'docs'],
  },
  summarize: {
    name: 'summarize',
    description: 'Summarize the current context or selected content',
    type: 'prompt' as const,
    source: 'builtin' as const,
    enabled: true,
    tags: ['text', 'summary'],
  },
  explain: {
    name: 'explain',
    description: 'Explain code or concepts in detail',
    type: 'prompt' as const,
    source: 'builtin' as const,
    enabled: true,
    tags: ['education', 'code'],
  },
  refactor: {
    name: 'refactor',
    description: 'Refactor code to improve quality',
    type: 'agent' as const,
    source: 'builtin' as const,
    enabled: true,
    tags: ['code', 'improvement'],
  },
  test: {
    name: 'test',
    description: 'Generate or run tests',
    type: 'agent' as const,
    source: 'builtin' as const,
    enabled: true,
    tags: ['testing', 'quality'],
  },
};
