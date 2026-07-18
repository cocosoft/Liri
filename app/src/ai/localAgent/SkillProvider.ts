/**
 * Skill Provider
 * 集成 Skills 系统到 Mini Agent
 * 简化版本 - 不直接依赖 Skills 模块
 */

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'ai:localAgent:SkillProvider', level: LogLevel.INFO });

export interface SkillContext {
  input: string;
  messages: any[];
  [key: string]: any;
}

export interface SkillResult {
  success: boolean;
  output?: string;
  error?: string;
  usage?: Record<string, unknown>;
}

export interface SkillProviderConfig {
  enabled: boolean;
  skillRegistry?: any;
}

export interface SkillMatch {
  skillName: string;
  confidence: number;
  args?: Record<string, unknown>;
}

export interface ISkillRegistry {
  get(skillName: string): any;
  getAll(): any[];
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
      const manifest = skill.manifest || skill;
      const keywords = manifest.keywords || [];
      const skillName = manifest.name || '';

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
    return this.registry.getAll().map((s) => s.manifest?.name || s.name || '');
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
