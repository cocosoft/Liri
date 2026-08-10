/**
 * Skill Provider
 * 集成 Skills 系统到 Mini Agent
 * 简化版本 - 不直接依赖 Skills 模块
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('ai:localAgent:SkillProvider');

export interface SkillContext {
  input: string;
  messages: unknown[];
  [key: string]: unknown;
}

export interface SkillResult {
  success: boolean;
  output?: string;
  error?: string;
  usage?: Record<string, unknown>;
}

export interface SkillProviderConfig {
  enabled: boolean;
  skillRegistry?: ISkillRegistry;
}

export interface SkillMatch {
  skillName: string;
  confidence: number;
  args?: Record<string, unknown>;
}

export interface ISkillRegistry {
  get(skillName: string): Record<string, unknown>;
  getAll(): Record<string, unknown>[];
  has(skillName: string): boolean;
}

export interface ISkillExecutor {
  execute(skillName: string, context: SkillContext): Promise<SkillResult>;
}

export class SkillProvider {
  private registry: ISkillRegistry | null = null;
  private executor: ISkillExecutor | null = null;
  private enabled: boolean = false;

  constructor(config: SkillProviderConfig) {
    this.enabled = config.enabled;
    this.registry = config.skillRegistry || null;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setRegistry(registry: ISkillRegistry): void {
    this.registry = registry;
  }

  setExecutor(executor: ISkillExecutor): void {
    this.executor = executor;
  }

  getRegistry(): ISkillRegistry | null {
    return this.registry;
  }

  async executeSkill(
    skillName: string,
    context: SkillContext
  ): Promise<SkillResult> {
    if (!this.enabled) {
      return {
        success: false,
        error: 'Skill provider is disabled',
      };
    }

    if (!this.executor) {
      return {
        success: false,
        error: 'Skill executor not available',
      };
    }

    try {
      return await this.executor.execute(skillName, context);
    } catch (error) {
      return {
        success: false,
        error: `Skill execution error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  async matchSkill(input: string): Promise<SkillMatch | null> {
    if (!this.enabled || !this.registry) {
      return null;
    }

    const skills = this.registry.getAll();
    const lowerInput = input.toLowerCase();

    for (const skill of skills) {
      const manifest = (skill as Record<string, unknown>).manifest || skill;
      const keywords =
        ((manifest as Record<string, unknown>).keywords as string[]) || [];
      const skillName =
        ((manifest as Record<string, unknown>).name as string) || '';

      for (const keyword of keywords) {
        if (lowerInput.includes(keyword.toLowerCase())) {
          return {
            skillName,
            confidence: 0.8,
          };
        }
      }

      if (lowerInput.includes(skillName.toLowerCase())) {
        return {
          skillName,
          confidence: 0.9,
        };
      }
    }

    return null;
  }

  getAvailableSkills(): string[] {
    if (!this.registry) {
      return [];
    }
    return this.registry
      .getAll()
      .map(
        (s) =>
          (((s as Record<string, unknown>).manifest as Record<string, unknown>)
            ?.name ||
            (s as Record<string, unknown>).name ||
            '') as string
      );
  }

  hasSkill(skillName: string): boolean {
    return this.registry?.has(skillName) || false;
  }
}

let globalSkillProvider: SkillProvider | null = null;

export function getGlobalSkillProvider(): SkillProvider {
  if (!globalSkillProvider) {
    globalSkillProvider = new SkillProvider({ enabled: false });
  }
  return globalSkillProvider;
}

export function createSkillProvider(
  config?: SkillProviderConfig
): SkillProvider {
  return new SkillProvider(config || { enabled: false });
}
