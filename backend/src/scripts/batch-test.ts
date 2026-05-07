#!/usr/bin/env bun
/**
 * 批量命令测试脚本
 * 一次启动应用，测试多个命令
 */
import { executeOnce } from '../entrypoints/repl.js';

const commands = [
  // 已修改的命令 - 详细测试
  { cmd: '/todo', args: 'help', label: '/todo help' },
  { cmd: '/todo', args: 'list --json', label: '/todo list --json' },
  { cmd: '/todo', args: 'stats --json', label: '/todo stats --json' },
  { cmd: '/task', args: 'help', label: '/task help' },
  { cmd: '/task', args: 'list --json', label: '/task list --json' },
  { cmd: '/task', args: 'stats --json', label: '/task stats --json' },
  { cmd: '/lsp', args: 'help', label: '/lsp help' },
  { cmd: '/notebook', args: 'help', label: '/notebook help' },
  // 其他关键命令 - 快速验证
  { cmd: '/help', args: '', label: '/help' },
  { cmd: '/version', args: '', label: '/version' },
  { cmd: '/status', args: '', label: '/status' },
  { cmd: '/session', args: 'list --json', label: '/session list --json' },
  { cmd: '/tool', args: 'list --json', label: '/tool list --json' },
];

const results: { label: string; success: boolean; output: string; error?: string }[] = [];

for (const { cmd, args, label } of commands) {
  try {
    console.log(`\n========== 测试: ${label} ==========`);
    const startTime = Date.now();
    const result = await executeOnce(cmd, args);
    const duration = Date.now() - startTime;

    if (result) {
      const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      console.log(output);
      console.log(`耗时: ${duration}ms`);
      results.push({ label, success: true, output: output.substring(0, 200) });
    } else {
      console.log('(无输出)');
      results.push({ label, success: true, output: '(无输出)' });
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`错误: ${errMsg}`);
    results.push({ label, success: false, error: errMsg, output: '' });
  }
}

console.log('\n\n========== 测试结果汇总 ==========');
let passed = 0;
let failed = 0;
for (const r of results) {
  const icon = r.success ? '✅' : '❌';
  console.log(`${icon} ${r.label}: ${r.success ? '通过' : '失败'}`);
  if (r.success) passed++;
  else failed++;
}
console.log(`\n总计: ${results.length} | 通过: ${passed} | 失败: ${failed}`);
