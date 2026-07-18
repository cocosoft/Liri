#!/usr/bin/env bun
/**
 * 高效批量命令测试脚本（单进程）
 */
import { init } from '../entrypoints/init.js';
import { commandExecutor } from '../commands/executor/index.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'scripts:batch-test-v3', level: LogLevel.INFO });

const TEST_COMMANDS = [
  // A组: 基础命令
  { cmd: 'help', label: 'help' },
  { cmd: 'status', label: 'status' },
  { cmd: 'version', label: 'version' },
  { cmd: 'clear', label: 'clear' },

  // B组: 此次修复的关键命令
  { cmd: 'stickers help', label: 'stickers' },
  { cmd: 'pr-comments help', label: 'pr-comments' },
  { cmd: 'tutorial help', label: 'tutorial' },
  { cmd: 'theme help', label: 'theme' },
  { cmd: 'keyboard help', label: 'keyboard' },
  { cmd: 'workspace help', label: 'workspace' },
  { cmd: 'timer help', label: 'timer' },
  { cmd: 'vim help', label: 'vim' },
  { cmd: 'voice help', label: 'voice' },
  { cmd: 'fast help', label: 'fast' },
  { cmd: 'diff help', label: 'diff' },
  { cmd: 'review help', label: 'review' },
  { cmd: 'resume list', label: 'resume' },

  // C组: 工具命令
  { cmd: 'write help', label: 'write' },
  { cmd: 'edit help', label: 'edit' },
  { cmd: 'glob help', label: 'glob' },
  { cmd: 'bash help', label: 'bash' },
  { cmd: 'grep help', label: 'grep' },
  { cmd: 'fetch help', label: 'fetch' },
  { cmd: 'todo help', label: 'todo' },
  { cmd: 'task help', label: 'task' },

  // D组: 新增遗漏命令
  { cmd: 'copy help', label: 'copy' },
  { cmd: 'branch help', label: 'branch' },
  { cmd: 'plan help', label: 'plan' },
  { cmd: 'init help', label: 'init' },
  { cmd: 'context help', label: 'context' },
  { cmd: 'debug help', label: 'debug' },
  { cmd: 'search help', label: 'search' },
  { cmd: 'tag help', label: 'tag' },

  // E组: 配置与系统命令
  { cmd: 'config help', label: 'config' },
  { cmd: 'session help', label: 'session' },
  { cmd: 'history help', label: 'history' },
  { cmd: 'skill help', label: 'skill' },
  { cmd: 'doctor help', label: 'doctor' },
  { cmd: 'env help', label: 'env' },
  { cmd: 'memory help', label: 'memory' },
];

console.log('===== 批量命令测试 =====\n');

await init();

let passed = 0;
let failed: { label: string; err: string }[] = [];
let warnings: { label: string; err: string }[] = [];

for (let i = 0; i < TEST_COMMANDS.length; i++) {
  const { cmd, label } = TEST_COMMANDS[i];

  try {
    const start = Date.now();
    const result = await commandExecutor.execute(cmd, {});
    const elapsed = Date.now() - start;

    if (result.success) {
      console.log(`✅ ${label.padEnd(20)} (${elapsed}ms)`);
      passed++;
    } else {
      const errMsg = (result.error || result.message || 'unknown').substring(
        0,
        60
      );
      if (
        errMsg.toLowerCase().includes('not implement') ||
        errMsg.toLowerCase().includes('not support')
      ) {
        console.log(`⚠ ${label.padEnd(20)} ${errMsg}`);
        warnings.push({ label, err: errMsg });
      } else {
        console.log(`❌ ${label.padEnd(20)} ${errMsg}`);
        failed.push({ label, err: errMsg });
      }
    }
  } catch (err: any) {
    const msg = (err.message || String(err)).substring(0, 60);
    console.log(`❌ ${label.padEnd(20)} ${msg}`);
    failed.push({ label, err: msg });
  }

  process.stdout.write(`\r进度: ${i + 1}/${TEST_COMMANDS.length}`);
}

console.log(`\n\n========= 汇总 =========`);
console.log(`总计: ${TEST_COMMANDS.length} 个命令`);
console.log(`✅ 通过: ${passed}`);
console.log(`⚠ 警告: ${warnings.length}`);
console.log(`❌ 失败: ${failed.length}`);

if (failed.length > 0) {
  console.log(`\n失败详情:`);
  for (const f of failed) console.log(`  ❌ ${f.label}: ${f.err}`);
}
if (warnings.length > 0) {
  console.log(`\n警告详情:`);
  for (const w of warnings) console.log(`  ⚠ ${w.label}: ${w.err}`);
}
