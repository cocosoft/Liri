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
 * CLI Dependencies Checker
 * 对标OpenClaw cli/deps.ts
 * 运行时依赖检测
 */

import { execSync } from 'node:child_process';

export interface DependencyInfo {
  name: string;
  version?: string;
  minVersion?: string;
  installed: boolean;
  satisfied: boolean;
  path?: string;
  type: 'binary' | 'module' | 'runtime' | 'system';
}

export interface DependencyCheckResult {
  allSatisfied: boolean;
  dependencies: DependencyInfo[];
  missing: string[];
  unsatisfied: string[];
}

export interface DepsCheckOptions {
  checkVersion?: boolean;
  verbose?: boolean;
}

const BINARY_DEPENDENCIES: Array<{
  name: string;
  minVersion?: string;
  verifyCommand?: string;
}> = [
  { name: 'node', minVersion: '18.0.0', verifyCommand: 'node --version' },
  { name: 'npm', minVersion: '8.0.0', verifyCommand: 'npm --version' },
  { name: 'git', minVersion: '2.0.0', verifyCommand: 'git --version' },
  { name: 'bun', verifyCommand: 'bun --version' },
];

const RUNTIME_DEPENDENCIES: Array<{
  name: string;
  minVersion?: string;
  verifyCommand: string;
}> = [
  { name: 'TypeScript', verifyCommand: 'npx tsc --version' },
  { name: 'ESLint', verifyCommand: 'npx eslint --version' },
];

function parseVersion(version: string): number[] {
  return version
    .replace(/[^0-9.]/g, '')
    .split('.')
    .map(Number);
}

function compareVersions(current: string, minVersion: string): boolean {
  const cur = parseVersion(current);
  const min = parseVersion(minVersion);

  for (let i = 0; i < Math.max(cur.length, min.length); i++) {
    const c = cur[i] ?? 0;
    const m = min[i] ?? 0;
    if (c > m) return true;
    if (c < m) return false;
  }

  return true;
}

async function checkBinary(
  name: string,
  verifyCommand?: string,
  minVersion?: string,
  options?: DepsCheckOptions
): Promise<DependencyInfo> {
  try {
    const cmd = verifyCommand ?? `${name} --version`;
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim();
    const firstLine = output.split('\n')[0].trim();

    const versionMatch = firstLine.match(/(\d+\.\d+\.\d+)/);
    const version = versionMatch ? versionMatch[1] : undefined;

    let satisfied = true;
    if (minVersion && version) {
      satisfied = compareVersions(version, minVersion);
    }

    const binaryPath = execSync(
      process.platform === 'win32' ? `where ${name}` : `which ${name}`,
      { encoding: 'utf-8', timeout: 3000 }
    ).trim();

    return {
      name,
      version,
      minVersion,
      installed: true,
      satisfied,
      path: binaryPath,
      type: 'binary',
    };
  } catch {
    return {
      name,
      installed: false,
      satisfied: false,
      type: 'binary',
    };
  }
}

export async function checkAllDependencies(
  options?: DepsCheckOptions
): Promise<DependencyCheckResult> {
  const deps: DependencyInfo[] = [];
  const opts: DepsCheckOptions = {
    checkVersion: true,
    verbose: false,
    ...options,
  };

  for (const binary of BINARY_DEPENDENCIES) {
    const info = await checkBinary(
      binary.name,
      binary.verifyCommand,
      binary.minVersion,
      opts
    );
    deps.push(info);
  }

  for (const dep of RUNTIME_DEPENDENCIES) {
    const info = await checkBinary(
      dep.name,
      dep.verifyCommand,
      dep.minVersion,
      opts
    );
    deps.push(info);
  }

  const missing = deps.filter((d) => !d.installed).map((d) => d.name);
  const unsatisfied = deps
    .filter((d) => d.installed && !d.satisfied)
    .map((d) => d.name);

  return {
    allSatisfied: missing.length === 0 && unsatisfied.length === 0,
    dependencies: deps,
    missing,
    unsatisfied,
  };
}

export async function checkDependency(
  name: string,
  options?: DepsCheckOptions
): Promise<DependencyInfo> {
  const binary = BINARY_DEPENDENCIES.find((b) => b.name === name);
  if (binary) {
    return checkBinary(
      binary.name,
      binary.verifyCommand,
      binary.minVersion,
      options
    );
  }

  const runtime = RUNTIME_DEPENDENCIES.find((r) => r.name === name);
  if (runtime) {
    return checkBinary(
      runtime.name,
      runtime.verifyCommand,
      runtime.minVersion,
      options
    );
  }

  try {
    const output = execSync(`${name} --version`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    const versionMatch = output.match(/(\d+\.\d+\.\d+)/);
    return {
      name,
      version: versionMatch ? versionMatch[1] : undefined,
      installed: true,
      satisfied: true,
      type: 'binary',
    };
  } catch {
    return {
      name,
      installed: false,
      satisfied: false,
      type: 'binary',
    };
  }
}

export function formatDependencyReport(result: DependencyCheckResult): string {
  const lines: string[] = ['Dependency Check Report', ''];

  for (const dep of result.dependencies) {
    const status = dep.installed ? (dep.satisfied ? '✅' : '⚠️') : '❌';

    const version = dep.version ?? (dep.installed ? 'unknown' : 'not found');
    const minVer = dep.minVersion ? ` (>= ${dep.minVersion})` : '';

    lines.push(
      `  ${status} ${dep.name.padEnd(15)} ${version.padEnd(15)} ${minVer}`
    );
  }

  lines.push('');

  if (result.allSatisfied) {
    lines.push('✅ All dependencies satisfied.');
  } else {
    if (result.missing.length > 0) {
      lines.push(`❌ Missing: ${result.missing.join(', ')}`);
    }
    if (result.unsatisfied.length > 0) {
      lines.push(`⚠️  Version mismatch: ${result.unsatisfied.join(', ')}`);
    }
  }

  return lines.join('\n');
}
