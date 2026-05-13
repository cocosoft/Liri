/**
 * Onboard命令
 * 引导式初始化设置
 * 对齐 OpenClaw commands/onboard.ts
 */

import type { Command, CommandContext, CommandResult } from '@modules/commands/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const logger = new Logger({ level: LogLevel.INFO });

const onboard: Command = {
  type: 'local',
  name: 'onboard',
  description: 'Guided initial setup and configuration',
  aliases: ['setup', 'init', 'welcome'],
  loadedFrom: 'builtin',
  disableModelInvocation: true,
  userInvocable: true,

  async load() {
    return {
      async execute(args: string, context?: CommandContext): Promise<CommandResult> {
        try {
          const results = await runOnboard();
          return {
            success: true,
            type: 'text',
            message: results.join('\n'),
          };
        } catch (error) {
          logger.error('引导设置失败', error as Error);
          return {
            success: false,
            type: 'error',
            error: `引导设置失败: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    };
  },
};

async function runOnboard(): Promise<string[]> {
  const results: string[] = [];
  const cwd = process.cwd();

  results.push('═══════════════════════════════════════════');
  results.push('          PY_APP 引导设置');
  results.push('═══════════════════════════════════════════');
  results.push('');

  // Step 1: 目录结构
  results.push('Step 1: 初始化目录结构...');
  const dirs = ['config', 'configs', 'data', 'logs', 'plugins', 'backups'];
  for (const dir of dirs) {
    const dirPath = join(cwd, dir);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
      results.push(`  创建目录: ${dir}`);
    }
  }
  results.push('  ✅ 目录结构就绪');

  // Step 2: 配置文件
  results.push('');
  results.push('Step 2: 初始化配置文件...');
  const initFiles = [
    { path: join(cwd, 'config.json'), content: JSON.stringify({ name: 'PY_APP', version: '1.0.0' }, null, 2), label: 'config.json' },
    { path: join(cwd, 'config', 'governance.json'), content: JSON.stringify({ allowAllModels: false, maxTokensPerRequest: 200000 }, null, 2), label: 'config/governance.json' },
    { path: join(cwd, 'configs', 'permissions.yaml'), content: '# PY_APP 权限配置\nroles:\n  admin:\n    allow: ["*\"]\n  user:\n    allow: ["read", "write", "search"]\n', label: 'configs/permissions.yaml' },
  ];

  for (const file of initFiles) {
    if (!existsSync(file.path)) {
      writeFileSync(file.path, file.content);
      results.push(`  创建: ${file.label}`);
    }
  }
  results.push('  ✅ 配置文件就绪');

  // Step 3: 环境检测
  results.push('');
  results.push('Step 3: 检测运行环境...');
  results.push(`  运行时: Node.js ${process.version}`);
  results.push(`  平台: ${process.platform} (${process.arch})`);
  results.push(`  包管理器: ${existsSync(join(cwd, 'bun.lock')) ? 'Bun' : existsSync(join(cwd, 'package-lock.json')) ? 'npm' : '未知'}`);
  const isDocker = existsSync('/.dockerenv') || existsSync(join(cwd, 'Dockerfile'));
  results.push(`  Docker: ${isDocker ? '是' : '否'}`);
  results.push('  ✅ 环境检测完成');

  // Step 4: 快速诊断
  results.push('');
  results.push('Step 4: 快速安全诊断...');
  const envPath = join(cwd, '.env');
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, 'utf-8');
      const hasApiKey = /API[_-]?KEY\s*=\s*[^\s]+/.test(content);
      results.push(`  .env 检测: ${hasApiKey ? '✅ API Key 已配置' : '⚠️ 未检测到 API Key'}`);
    } catch {
      results.push('  ⚠️ .env 读取失败');
    }
  } else {
    results.push('  💡 创建 .env 文件以配置 API Key（参考 .env.example）');
  }
  results.push('  ✅ 快速诊断完成');

  results.push('');
  results.push('═══════════════════════════════════════════');
  results.push('引导设置完成！运行 py_app doctor 进行完整诊断。');
  return results;
}

export default onboard;
