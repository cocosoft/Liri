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
export enum SkillSource {
  USER = 'user',
  PROJECT = 'project',
  PLUGIN = 'plugin',
  BUILTIN = 'builtin',
  MCP = 'mcp',
  BUNDLED = 'bundled',
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
  aliases?: string[];
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
  executeSkill(name: string, args: any, toolUseContext: any): Promise<unknown>;
}
