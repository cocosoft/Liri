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
 * Agent Path Policy
 * 对标OpenClaw agents/path-policy.ts
 * 路径策略控制
 */

export type PathAccessLevel = 'allow' | 'deny' | 'ask' | 'readonly';

export interface PathPolicyRule {
  pattern: string;
  access: PathAccessLevel;
  reason?: string;
  priority?: number;
}

export interface PathPolicyResult {
  allowed: boolean;
  access: PathAccessLevel;
  matchedRule?: PathPolicyRule;
  reason?: string;
}

export interface PathPolicyConfig {
  defaultAccess?: PathAccessLevel;
  allowSymlinks?: boolean;
  allowDotFiles?: boolean;
  projectRoot?: string;
}

const DEFAULT_RULES: PathPolicyRule[] = [
  {
    pattern: 'node_modules/**',
    access: 'deny',
    reason: 'Node modules are not editable',
    priority: 80,
  },
  {
    pattern: '.git/**',
    access: 'deny',
    reason: 'Git internals are protected',
    priority: 90,
  },
  {
    pattern: '.env',
    access: 'deny',
    reason: 'Environment files contain secrets',
    priority: 90,
  },
  {
    pattern: '.env.*',
    access: 'deny',
    reason: 'Environment files contain secrets',
    priority: 90,
  },
  {
    pattern: '**/node_modules/**',
    access: 'deny',
    reason: 'Node modules are not editable',
    priority: 80,
  },
  {
    pattern: '**/.git/**',
    access: 'deny',
    reason: 'Git internals are protected',
    priority: 90,
  },
  { pattern: '*.log', access: 'readonly', reason: 'Log files', priority: 30 },
  {
    pattern: 'dist/**',
    access: 'readonly',
    reason: 'Build output',
    priority: 40,
  },
  {
    pattern: 'build/**',
    access: 'readonly',
    reason: 'Build output',
    priority: 40,
  },
];

export class PathPolicyManager {
  private rules: PathPolicyRule[];
  private config: Required<PathPolicyConfig>;

  constructor(config?: PathPolicyConfig) {
    this.config = {
      defaultAccess: config?.defaultAccess ?? 'allow',
      allowSymlinks: config?.allowSymlinks ?? false,
      allowDotFiles: config?.allowDotFiles ?? false,
      projectRoot: config?.projectRoot ?? process.cwd(),
    };

    this.rules = [...DEFAULT_RULES];
  }

  addRule(rule: PathPolicyRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  removeRule(pattern: string): boolean {
    const index = this.rules.findIndex((r) => r.pattern === pattern);
    if (index === -1) return false;
    this.rules.splice(index, 1);
    return true;
  }

  setRules(rules: PathPolicyRule[]): void {
    this.rules = [...rules];
    this.rules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  getRules(): PathPolicyRule[] {
    return [...this.rules];
  }

  clearRules(): void {
    this.rules = [];
  }

  checkPath(filePath: string, mode?: 'read' | 'write'): PathPolicyResult {
    const normalizedPath = filePath.replace(/\\/g, '/');

    const secrets = ['API_KEY', 'SECRET', 'PASSWORD', 'TOKEN', 'PRIVATE_KEY'];
    for (const secret of secrets) {
      if (normalizedPath.toUpperCase().includes(secret)) {
        return {
          allowed: false,
          access: 'deny',
          reason: `Path contains sensitive keyword: ${secret}`,
        };
      }
    }

    for (const rule of this.rules) {
      try {
        const regex = this.patternToRegex(rule.pattern);
        if (regex.test(normalizedPath)) {
          const allowed =
            rule.access === 'allow' ||
            (rule.access === 'readonly' && mode === 'read');

          return {
            allowed,
            access: rule.access,
            matchedRule: rule,
            reason: rule.reason,
          };
        }
      } catch {
        continue;
      }
    }

    const defaultAccess = this.config.defaultAccess;
    const allowed =
      defaultAccess === 'allow' ||
      (defaultAccess === 'readonly' && mode === 'read');

    return {
      allowed,
      access: defaultAccess,
      reason: `Default policy: ${defaultAccess}`,
    };
  }

  isPathAllowed(filePath: string, mode?: 'read' | 'write'): boolean {
    return this.checkPath(filePath, mode).allowed;
  }

  setDefaultAccess(access: PathAccessLevel): void {
    this.config.defaultAccess = access;
  }

  getConfig(): Readonly<Required<PathPolicyConfig>> {
    return { ...this.config };
  }

  private patternToRegex(pattern: string): RegExp {
    let regexStr = pattern
      .replace(/\\/g, '/')
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '___DOUBLE_STAR___')
      .replace(/\*/g, '[^/]*')
      .replace(/___DOUBLE_STAR___/g, '.*');

    if (!regexStr.startsWith('^')) {
      regexStr = `.*/${regexStr}`;
    }

    return new RegExp(regexStr, 'i');
  }
}

export function createPathPolicyManager(
  config?: PathPolicyConfig
): PathPolicyManager {
  return new PathPolicyManager(config);
}
