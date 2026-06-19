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
 * Local Agent 核心类型定义
 * 普适性架构 - 核心层必需组件
 */

export interface Intent {
  type: IntentType;
  confidence: number;
  metadata?: Record<string, unknown>;
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
  target: RouteTarget | string;
  model?: string;
  handler?: string;
  fallback?: RouteDecision;
  reason?: string;
  /** 兼容 SmartRouter 的决策字段 */
  provider?: string;
  /** 兼容 SmartRouter 的决策 tier */
  tier?: string;
}

export type RouteTarget = 'rule_engine' | 'ollama' | 'cloud';

export interface DelegationConfig {
  enabled: boolean;
  complexityThreshold: number;
  maxDepth: number;
}

export interface LocalAgentConfig {
  ollama?: OllamaConfig;
  routing: RoutingConfig;
  delegation?: DelegationConfig;
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
  thresholds?: {
    ruleEngine: number;
    localLLM: number;
    cloud: number;
  };
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

export interface LocalAgentResult {
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
