/**
 * Claude.md深度集成服务（参考CC源码中Claude.md集成）
 * 解析Claude.md文件内容，提取规则和配置
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface ClaudeMdRules {
  behavioralGuidelines: string[];
  codingStandards: string[];
  reviewChecklist: string[];
  stylePreferences: string[];
}

export interface ClaudeMdConfig {
  enabled: boolean;
  path: string;
  rules: ClaudeMdRules;
}

export interface ClaudeMdIntegration {
  loadClaudeMd(cwd: string): Promise<ClaudeMdConfig | null>;
  parseClaudeMd(content: string): ClaudeMdRules;
  extractRulesBySection(content: string, section: string): string[];
}

export class ClaudeMdIntegrationImpl implements ClaudeMdIntegration {
  private readonly CLAUDE_MD_FILENAME = 'Claude.md';

  async loadClaudeMd(cwd: string): Promise<ClaudeMdConfig | null> {
    const filePath = join(cwd, this.CLAUDE_MD_FILENAME);
    
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const rules = this.parseClaudeMd(content);
      
      return {
        enabled: true,
        path: filePath,
        rules,
      };
    } catch {
      return null;
    }
  }

  parseClaudeMd(content: string): ClaudeMdRules {
    return {
      behavioralGuidelines: this.extractRulesBySection(content, 'Behavioral Guidelines'),
      codingStandards: this.extractRulesBySection(content, 'Coding Standards'),
      reviewChecklist: this.extractRulesBySection(content, 'Review Checklist'),
      stylePreferences: this.extractRulesBySection(content, 'Style Preferences'),
    };
  }

  extractRulesBySection(content: string, section: string): string[] {
    const sectionRegex = new RegExp(`##\\s*${section}[^#]*`, 'i');
    const match = content.match(sectionRegex);
    
    if (!match) {
      return [];
    }

    const sectionContent = match[0];
    const bulletPoints = sectionContent.match(/[-*+]\s+.+/g) || [];
    
    return bulletPoints.map(point => point.replace(/^[-*+]\s+/, '').trim());
  }
}

export function createClaudeMdIntegration(): ClaudeMdIntegration {
  return new ClaudeMdIntegrationImpl();
}