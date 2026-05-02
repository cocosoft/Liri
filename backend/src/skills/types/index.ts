export enum SkillSource {
  USER = 'user',
  PROJECT = 'project',
  PLUGIN = 'plugin',
  BUILTIN = 'builtin',
  MCP = 'mcp',
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  arguments?: string[];
  'argument-hint'?: string;
  when_to_use?: string;
  'allowed-tools'?: string[];
  'user-invocable'?: boolean;
  model?: string;
  effort?: string;
  paths?: string[];
  version?: string;
  'disable-model-invocation'?: boolean;
  context?: 'fork';
  agent?: string;
  shell?: any;
}

export interface Skill {
  type: 'prompt';
  name: string;
  description: string;
  hasUserSpecifiedDescription: boolean;
  allowedTools: string[];
  argumentHint?: string;
  argNames?: string[];
  whenToUse?: string;
  version?: string;
  model?: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  context?: 'fork';
  agent?: string;
  effort?: string;
  paths?: string[];
  contentLength: number;
  isHidden: boolean;
  progressMessage: string;
  userFacingName(): string;
  source: SkillSource;
  loadedFrom: string;
  hooks?: any;
  skillRoot?: string;
  getPromptForCommand(
    args: any,
    toolUseContext: any
  ): Promise<{ type: string; text: string }[]>;
}

export interface SkillExecutionContext {
  args: any;
  toolUseContext: any;
  skill: Skill;
}

export interface SkillLoader {
  loadSkills(): Promise<Skill[]>;
  getSource(): SkillSource;
}

export interface SkillManager {
  registerLoader(loader: SkillLoader): void;
  loadSkills(): Promise<void>;
  getSkill(name: string): Skill | undefined;
  getSkills(): Skill[];
  executeSkill(name: string, args: any, toolUseContext: any): Promise<any>;
}
