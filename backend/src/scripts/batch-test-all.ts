#!/usr/bin/env bun
/**
 * 全量命令批量测试脚本
 * 使用 executeOnce 模式，每个命令独立子进程
 */
import { spawnSync } from 'child_process';
import { join } from 'path';

const ALL_COMMANDS = [
  'help',
  'status',
  'clear',
  'skill',
  'config',
  'history',
  'tool',
  'compact',
  'session',
  'exit',
  'advisor',
  'brief',
  'cache',
  'chat',
  'commit',
  'git',
  'complete',
  'parallel',
  'permission',
  'security',
  'vim',
  'voice',
  'export',
  'share',
  'version',
  'activity',
  'cost',
  'usage',
  'doctor',
  'fast',
  'memory',
  'hooks',
  'mcp',
  'plugins',
  'permissions',
  'tokens',
  'env',
  'debug',
  'subagent',
  'bridge',
  'ide',
  'tasks',
  'model',
  'write',
  'edit',
  'glob',
  'bash',
  'grep',
  'subagent-run',
  'agent-instance',
  'fetch',
  'websearch',
  'todo',
  'task',
  'lsp',
  'notebook',
  'copy',
  'branch',
  'add-dir',
  'context',
  'rename',
  'rewind',
  'init',
  'effort',
  'keybindings',
  'privacy-settings',
  'output-style',
  'files',
  'sandbox-toggle',
  'remote-env',
  'insights',
  'plan',
  'upgrade',
  'passes',
  'reload-plugins',
  'terminalSetup',
  'feedback',
  'extra-usage',
  'release-notes',
  'thinkback',
  'statusline',
  'rate-limit-options',
  'chrome',
  'btw',
  'tag',
  'color',
  'desktop',
  'mobile',
  'login',
  'logout',
  'install-github-app',
  'install-slack-app',
  'stickers',
  'heapdump',
  'pr-comments',
  'search',
  'restart',
  'tutorial',
  'theme',
  'keyboard',
  'workspace',
  'timer',
  'diff',
  'review',
  'resume',
];

const SCRIPT_DIR = import.meta.dirname;
const INDEX_PATH = join(SCRIPT_DIR, '..', 'index.ts');

console.log('===== 全量命令批量测试 =====\n');
console.log(`共 ${ALL_COMMANDS.length} 个命令\n`);

let passed = 0;
let warning = 0;
let failed = 0;

interface TestResult {
  cmd: string;
  status: string;
  detail: string;
}
const results: TestResult[] = [];

for (let i = 0; i < ALL_COMMANDS.length; i++) {
  const cmdName = ALL_COMMANDS[i];
  const label = `/ ${cmdName}`;

  const startTime = Date.now();
  const proc = spawnSync(
    'bun',
    ['run', '--silent', INDEX_PATH, '--print', `/${cmdName}`, 'help'],
    {
      cwd: join(SCRIPT_DIR, '..'),
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    }
  );

  const elapsed = Date.now() - startTime;
  const stdout = proc.stdout?.toString() || '';
  const stderr = proc.stderr?.toString() || '';
  const statusCode = proc.status;

  // 提取关键输出
  const cleanLines = (stdout + '\n' + stderr).split('\n').filter((l) => {
    const nl = l.trim();
    if (!nl) return false;
    if (
      nl.startsWith('[') &&
      (nl.includes('] [INFO]') ||
        nl.includes('] [Infrastructure') ||
        nl.includes('] 监控') ||
        nl.includes('] 内存') ||
        nl.includes('] 插件') ||
        nl.includes('] 命令') ||
        nl.includes('] MCP'))
    )
      return false;
    if (nl.includes('OAUTH_ENCRYPTION_KEY')) return false;
    if (
      nl.includes('插件系统') ||
      nl.includes('命令系统') ||
      nl.includes('Loaded') ||
      nl.includes('Initializing') ||
      nl.includes('初始')
    )
      return false;
    if (nl.includes('graceful')) return false;
    if (nl === 'Command system initialized successfully') return false;
    if (nl.includes('MCP系统') || nl.includes('内存监控')) return false;
    return true;
  });

  const output =
    cleanLines.slice(-5).join('|').substring(0, 100) ||
    cleanLines.slice(-3).join('|').substring(0, 100);

  if (proc.error && (proc.error as any).code === 'ETIMEDOUT') {
    results.push({ cmd: label, status: '❌', detail: `超时 (15s)` });
    failed++;
  } else if (statusCode !== 0 && statusCode !== null) {
    const errInfo = output || `exit code ${statusCode}`;
    if (
      errInfo.toLowerCase().includes('not implement') ||
      errInfo.toLowerCase().includes('not support')
    ) {
      results.push({
        cmd: label,
        status: '⚠',
        detail: errInfo.substring(0, 80),
      });
      warning++;
    } else {
      results.push({
        cmd: label,
        status: '❌',
        detail: errInfo.substring(0, 80),
      });
      failed++;
    }
  } else {
    results.push({
      cmd: label,
      status: '✅',
      detail: `(${elapsed}ms) ${output.substring(0, 60)}`,
    });
    passed++;
  }

  process.stdout.write(
    `\r进度: ${i + 1}/${ALL_COMMANDS.length}  ✅${passed} ⚠${warning} ❌${failed}`
  );
}

console.log('\n\n========= 测试结果总表 =========\n');
for (const r of results) {
  console.log(`${r.status} ${r.cmd.padEnd(26)} ${r.detail}`);
}

console.log(`\n========= 汇总 =========`);
console.log(`总计: ${ALL_COMMANDS.length} 个命令`);
console.log(`✅ 通过: ${passed}`);
console.log(`⚠ 警告: ${warning}`);
console.log(`❌ 失败: ${failed}`);

const failedList = results.filter((r) => r.status === '❌');
if (failedList.length > 0) {
  console.log(`\n========= 失败详情 =========`);
  for (const r of failedList) {
    console.log(`❌ ${r.cmd}: ${r.detail}`);
  }
}
