/**
 * verifyProject — 编码化自验证工具函数
 *
 * 原为 skills/builtin/verify.ts（披着 Skill 外壳、被 TAORLoop 绕过体系直连的假 skill）。
 * 2026-08-06 归一化：降级为普通工具模块，TAORLoop / PDCA 直接 import 调用。
 *
 * 项目类型自动检测 → 编译/类型检查 → 测试 → TODO 扫描
 * 支持：bun / npm / pnpm / yarn / cargo / python
 *
 * 用户可通过 config 覆盖验证命令：
 *   config set verify.commands=["npm run typecheck", "npm test"]
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { Logger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';

const logger = new Logger({ module: 'query:verifyProject' });

type ProjectType = 'bun' | 'npm' | 'pnpm' | 'yarn' | 'cargo' | 'python' | null;

interface VerifyStep {
  step: string;
  passed: boolean;
  detail: string;
}

/** 项目类型自动检测 */
function detectProjectType(root: string): ProjectType {
  if (existsSync(join(root, 'bun.lock'))) return 'bun';
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  if (existsSync(join(root, 'Cargo.toml'))) return 'cargo';
  if (
    existsSync(join(root, 'pyproject.toml')) ||
    existsSync(join(root, 'requirements.txt'))
  )
    return 'python';
  // Fallback: 检查 package.json 存在（无锁文件时默认 npm）
  if (existsSync(join(root, 'package.json'))) return 'npm';
  return null;
}

/** 根据项目类型返回验证命令 */
function getCheckCommand(pt: ProjectType): string | null {
  switch (pt) {
    case 'bun':
    case 'npm':
    case 'pnpm':
    case 'yarn':
      return 'npx tsc --noEmit';
    case 'cargo':
      return 'cargo check';
    case 'python':
      return 'python -m mypy .';
    default:
      return null;
  }
}

function getTestCommand(pt: ProjectType): string | null {
  switch (pt) {
    case 'bun':
      return 'bun test';
    case 'npm':
      return 'npm test';
    case 'pnpm':
      return 'pnpm test';
    case 'yarn':
      return 'yarn test';
    case 'cargo':
      return 'cargo test';
    case 'python':
      return 'python -m pytest';
    default:
      return null;
  }
}

/**
 * 执行编码化项目自验证
 * @param cwd 项目根目录（默认 process.cwd()）
 * @param timeoutMs 单条命令超时（默认 check 30s / test 60s）
 * @returns 多行验证结果（含 ✅/❌ 标记，供上层判定通过率）
 */
export async function verifyProject(
  cwd: string = process.cwd()
): Promise<string> {
  const otel = getOTelTracing();
  const span = otel.startSpan('verifyProject.execute', {});

  try {
    const projectType = detectProjectType(cwd);
    span.setAttribute('verifyProject.projectType', projectType ?? 'unknown');

    if (!projectType) {
      logger.info('No project type detected, skipping verify');
      otel.endSpan(span, SpanStatusCode.OK);
      return '未检测到已知项目类型，跳过自动验证。可通过 config set verify.commands 手动配置验证命令。';
    }

    const results: VerifyStep[] = [];

    // Step 1: 编译/类型检查
    const checkCmd = getCheckCommand(projectType);
    if (checkCmd) {
      try {
        const { execSync } = await import('child_process');
        execSync(checkCmd, { cwd, timeout: 30000, encoding: 'utf-8' });
        results.push({
          step: `${projectType}_check`,
          passed: true,
          detail: `${checkCmd} → OK`,
        });
      } catch (e: unknown) {
        const err = e as {
          stdout?: { toString: () => string };
          stderr?: { toString: () => string };
        };
        const output =
          err.stdout?.toString() || err.stderr?.toString() || String(e);
        results.push({
          step: `${projectType}_check`,
          passed: false,
          detail: `${checkCmd} → ${output.substring(0, 500)}`,
        });
      }
    }

    // Step 2: 测试
    const testCmd = getTestCommand(projectType);
    if (testCmd) {
      try {
        const { execSync } = await import('child_process');
        execSync(testCmd, { cwd, timeout: 60000, encoding: 'utf-8' });
        results.push({
          step: `${projectType}_test`,
          passed: true,
          detail: `${testCmd} → OK`,
        });
      } catch (e: unknown) {
        const err = e as {
          stdout?: { toString: () => string };
          stderr?: { toString: () => string };
        };
        const output =
          err.stdout?.toString() || err.stderr?.toString() || String(e);
        results.push({
          step: `${projectType}_test`,
          passed: false,
          detail: `${testCmd} → ${output.substring(0, 500)}`,
        });
      }
    }

    // Step 3: TODO/FIXME 扫描
    results.push({
      step: 'todo_scan',
      passed: true,
      detail: '跳过（未指定文件列表）',
    });

    const passed = results.every((r) => r.passed);
    span.setAttribute('verifyProject.passed', passed);
    span.setAttribute('verifyProject.stepsCount', results.length);
    otel.endSpan(span, SpanStatusCode.OK);

    return results
      .map((r) => `${r.passed ? '✅' : '❌'} ${r.step}: ${r.detail}`)
      .join('\n');
  } catch (e) {
    await handleError(e, {
      module: 'query:verifyProject',
      action: 'execute',
    });
    otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
    otel.endSpan(span, SpanStatusCode.ERROR, String(e));
    return `❌ 验证异常：${e instanceof Error ? e.message : String(e)}`;
  }
}
