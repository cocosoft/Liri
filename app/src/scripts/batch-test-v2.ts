#!/usr/bin/env bun
/**
 * 高效批量命令测试脚本（单进程，初始化一次测试多个命令）
 */
import { profileCheckpoint } from '../utils/startupProfiler';
import { init } from '../entrypoints/init.js';
import { commandExecutor } from '../commands/executor/index.js';
import { initializeChatManager } from '../entrypoints/repl.js';
import type { CommandContext } from '../commands/types';

const TEST_COMMANDS = [
  // A组: 基础命令
  { cmd: 'help args=help', label: 'help' },
  { cmd: 'status', label: 'status' },
  { cmd: 'clear', label: 'clear' },
  { cmd: 'version', label: 'version' },

  // B组: 配置与系统
  { cmd: 'config help', label: 'config' },
  { cmd: 'session help', label: 'session' },
  { cmd: 'history help', label: 'history' },
  { cmd: 'skill help', label: 'skill' },

  // C组: 此次修复的关键命令
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
  { cmd: 'resume help', label: 'resume' },

  // D组: 工具命令
  { cmd: 'write help', label: 'write' },
  { cmd: 'edit help', label: 'edit' },
  { cmd: 'glob help', label: 'glob' },
  { cmd: 'bash help', label: 'bash' },
  { cmd: 'grep help', label: 'grep' },
  { cmd: 'fetch help', label: 'fetch' },
  { cmd: 'todo help', label: 'todo' },
  { cmd: 'task help', label: 'task' },
  { cmd: 'lsp help', label: 'lsp' },
  { cmd: 'notebook help', label: 'notebook' },

  // E组: 新增遗漏命令
  { cmd: 'copy help', label: 'copy' },
  { cmd: 'branch help', label: 'branch' },
  { cmd: 'plan help', label: 'plan' },
  { cmd: 'init help', label: 'init' },
  { cmd: 'context help', label: 'context' },
  { cmd: 'debug help', label: 'debug' },
  { cmd: 'search help', label: 'search' },
  { cmd: 'tags help', label: 'tag' },
];

console.log('===== 批量命令测试 =====\n');

await init();

const chatManager = await initializeChatManager();
const baseContext: CommandContext = {
  sessionId: `test-${Date.now()}`,
  chatManager,
};

let passed = 0;
let failed = 0;

for (const { cmd, label } of TEST_COMMANDS) {
  try {
    const start = Date.now();
    const result = await commandExecutor.execute(cmd, baseContext);
    const elapsed = Date.now() - start;

    if (result.success) {
      console.log(`✅ ${label.padEnd(20)} (${elapsed}ms)`);
      passed++;
    } else {
      const errMsg = result.error
        ? result.error.substring(0, 50)
        : 'unknown error';
      console.log(`❌ ${label.padEnd(20)} ${errMsg}`);
      failed++;
    }
  } catch (err: any) {
    console.log(
      `❌ ${label.padEnd(20)} ${(err.message || '').substring(0, 50)}`
    );
    failed++;
  }
}

console.log(
  `\n完成: ${TEST_COMMANDS.length} 个命令 | ✅ ${passed} | ❌ ${failed}`
);
