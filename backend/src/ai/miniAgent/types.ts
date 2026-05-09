//
/**
 * Mini Agent 核心类型定义
 * 普适性架构 - 核心层必需组件
 */

import type { ChatMessage } from '../models/types.js';

export interface Intent {
  type: IntentType;
  confidence: number;
  metadata?: Record<string, any>;
}

export type IntentType =
  | 'command'
  | 'code_generation'
  | 'explanation'
  | 'simple_qa'
  | 'skill'
  | 'mcp'
  | 'general';

export interface RouteDecision {
  target: RouteTarget;
  model?: string;
  handler?: string;
  fallback?: RouteDecision;
  reason?: string;
}

export type RouteTarget = 'rule_engine' | 'ollama' | 'cloud';

export interface MiniAgentConfig {
  ollama?: OllamaConfig;
  routing: RoutingConfig;
}

export interface OllamaConfig {
  enabled: boolean;
  baseUrl: string;
  defaultModel: string;
  timeout: number;
}

export interface RoutingConfig {
  strategy: RoutingStrategy;
  fallbackToCloud: boolean;
}

export type RoutingStrategy = 'cloud-first' | 'ollama-first' | 'local-first';

export interface CommandMatch {
  action: CommandAction;
  args?: Record<string, string>;
}

export type CommandAction = 'create' | 'delete' | 'read' | 'write' | 'execute';

export interface RuleMatch {
  pattern: string;
  intent: Intent;
  routeDecision: RouteDecision;
}

export interface MiniAgentResult {
  response: string;
  intent: Intent;
  routeDecision: RouteDecision;
  tokens?: {
    input: number;
    output: number;
    total: number;
  };
  source: 'rule_engine' | 'ollama' | 'cloud';
}

export type IntentClassifier = (input: string) => Intent;

export type TaskRouter = (intent: Intent, context?: any) => RouteDecision;

export interface CommandExecutor {
  execute(match: CommandMatch, context?: any): Promise<string>;
}

export interface IRuleEngine {
  classify(input: string): Intent;
  match(input: string): RuleMatch | null;
}

export interface IOllamaProvider {
  isAvailable(): Promise<boolean>;
  generate(
    prompt: string,
    options?: OllamaGenerateOptions
  ): Promise<OllamaResponse>;
  chat(
    messages: ChatMessage[],
    options?: OllamaChatOptions
  ): Promise<OllamaChatResponse>;
  listModels(): Promise<string[]>;
}

export interface OllamaGenerateOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

export interface OllamaChatOptions extends OllamaGenerateOptions {
  tools?: any[];
}

export interface OllamaResponse {
  model: string;
  response: string;
  done: boolean;
  context?: number[];
  totalDuration?: number;
  loadDuration?: number;
  promptEvalCount?: number;
  evalCount?: number;
}

export interface OllamaChatResponse {
  model: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  totalDuration?: number;
}

export const ROUTING_KEYWORDS: Record<IntentType, string[]> = {
  command: [
    '创建',
    '删除',
    '打开',
    '关闭',
    '执行',
    '运行',
    '新建',
    'mkdir',
    'rm',
    'del',
    'create',
    'delete',
    'open',
    'close',
    'execute',
    'run',
    'new',
  ],
  code_generation: [
    '写代码',
    '生成代码',
    '实现',
    '帮我写',
    'create function',
    'write code',
    'generate code',
    'implement',
  ],
  explanation: [
    '解释',
    '什么是',
    '讲讲',
    '为什么',
    '如何',
    'explain',
    'what is',
    'how to',
    'why',
  ],
  simple_qa: [
    '天气',
    '时间',
    '日期',
    '现在几点',
    '今天几号',
    'weather',
    'time',
    'date',
  ],
  skill: ['skill', '技能', '使用技能'],
  mcp: ['mcp', 'tool', '工具', '文件系统', 'git', 'bash'],
  general: [],
};

export const DEFAULT_ROUTING_RULES: RuleMatch[] = [
  {
    pattern: '^(创建|新建|mkdir|create).*',
    intent: { type: 'command', confidence: 0.9 },
    routeDecision: { target: 'rule_engine', handler: 'create' },
  },
  {
    pattern: '^(删除|rm|del|delete).*',
    intent: { type: 'command', confidence: 0.9 },
    routeDecision: { target: 'rule_engine', handler: 'delete' },
  },
  {
    pattern: '^(读取|读|cat|read|open).*',
    intent: { type: 'command', confidence: 0.9 },
    routeDecision: { target: 'rule_engine', handler: 'read' },
  },
  {
    pattern: '^(写入|写|write).*',
    intent: { type: 'command', confidence: 0.9 },
    routeDecision: { target: 'rule_engine', handler: 'write' },
  },
  {
    pattern: '.*(帮我写|生成代码|写代码|write code|generate code).*',
    intent: { type: 'code_generation', confidence: 0.8 },
    routeDecision: { target: 'cloud', reason: '需要强推理能力' },
  },
  {
    pattern: '.*(解释|什么是|explain|what is).*',
    intent: { type: 'explanation', confidence: 0.8 },
    routeDecision: { target: 'cloud', reason: '需要知识理解' },
  },
  {
    pattern: '.*(天气|time|时间|日期|weather|date).*',
    intent: { type: 'simple_qa', confidence: 0.9 },
    routeDecision: { target: 'rule_engine', reason: '简单查询' },
  },
  {
    pattern: '.*(skill|技能|使用技能).*',
    intent: { type: 'skill', confidence: 0.7 },
    routeDecision: {
      target: 'rule_engine',
      handler: 'skill',
      reason: '技能调用',
    },
  },
  {
    pattern: '.*(mcp|tool|工具).*',
    intent: { type: 'mcp', confidence: 0.7 },
    routeDecision: {
      target: 'rule_engine',
      handler: 'mcp',
      reason: 'MCP工具调用',
    },
  },
];
