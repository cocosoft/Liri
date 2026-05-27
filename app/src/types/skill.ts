/**
 * 技能系统类型定义
 */

export interface SkillManifest {
  name: string;
  description: string;
  version: string;
  author?: string;
  license?: string;
  category?: string;
  tags?: string[];
}

export interface SkillContext {
  [key: string]: any;
  userInput?: string;
  currentDirectory?: string;
  sessionId?: string;
  userId?: string;
}

export interface SkillResult {
  success: boolean;
  output?: string;
  error?: string;
  data?: any;
  usage?: {
    totalTokens?: number;
    durationMs?: number;
  };
}

export interface Skill {
  manifest: SkillManifest;
  execute: (context: SkillContext) => Promise<SkillResult>;
  validate?: (context: SkillContext) => boolean;
  cleanup?: () => Promise<void>;
}

export interface SkillLoader {
  load(skillPath: string): Promise<Skill>;
  loadAll(skillPaths: string[]): Promise<Skill[]>;
}

export interface SkillRegistry {
  register(skill: Skill): void;
  unregister(skillName: string): void;
  get(skillName: string): Skill | undefined;
  getAll(): Skill[];
  getByCategory(category: string): Skill[];
  getByTag(tag: string): Skill[];
}

export interface SkillExecutor {
  execute(skillName: string, context: SkillContext): Promise<SkillResult>;
  executeBatch(
    skills: Array<{ name: string; context: SkillContext }>
  ): Promise<SkillResult[]>;
  getAvailableSkills(): Skill[];
}

export interface BundledSkillDefinition {
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  allowedTools?: string[];
  argumentHint?: string;
  whenToUse?: string;
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  isEnabled?: () => boolean;
  getPromptForCommand?: (args: string) => string;
  hooks?: any;
  context?: any;
  agent?: any;
}
