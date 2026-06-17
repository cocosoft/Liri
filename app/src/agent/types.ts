/**
 * Agent 模块共享类型
 * 避免 AgentRouter ↔ StrategySelector 循环依赖
 */

export interface AgentRoute {
  agentId: string;
  workspaceDir: string;
  model: string;
  provider: string;
  maxTurns: number;
  tools: string[];
  isDefault: boolean;
  isSandboxed: boolean;
}

export interface RouteMatch {
  workspaceDir: string;
  taskType: 'code' | 'chat' | 'refactor' | 'review' | 'test' | 'general';
}

export enum TaskComplexity {
  SIMPLE = 'simple',
  MODERATE = 'moderate',
  COMPLEX = 'complex',
}

export enum ContextSize {
  SMALL = 'small',
  MEDIUM = 'medium',
  LARGE = 'large',
}

export interface TaskFeature {
  taskType: RouteMatch['taskType'];
  complexity: TaskComplexity;
  contextSize: ContextSize;
  requiredTools?: string[];
}

export interface StrategyRule {
  taskTypes?: RouteMatch['taskType'][];
  complexities?: TaskComplexity[];
  contextSizes?: ContextSize[];
  requiredTools?: string[];
  priority: number;
  target: {
    agentId?: string;
    model?: string;
    maxTurns?: number;
    isSandboxed?: boolean;
  };
}

export interface StrategySelection {
  route: AgentRoute | null;
  matchedRule?: StrategyRule;
  confidence: number;
}
