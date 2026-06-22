#!/usr/bin/env bun
/**
 * 分析 ESLint module-registry warning 分布
 * 临时脚本，分析完成后删除
 */
import { execSync } from 'node:child_process';

const result = execSync('npx eslint src/ --no-ignore --format json --quiet 2>nul', {
  cwd: 'e:\\PY\\CODES\\PY_APP\\app',
  encoding: 'utf-8',
});

const data = JSON.parse(result);

// 只统计 module-registry 规则
const modRegistryWarnings = data.filter((f: any) =>
  f.messages.some((m: any) => m.ruleId === 'module-registry/no-direct-module-import')
);

// 按模块统计
const moduleCounts: Record<string, number> = {};
const fileModuleCounts: Record<string, Record<string, number>> = {};

let warningCount = 0;
for (const file of modRegistryWarnings) {
  const msgs = file.messages.filter((m: any) => m.ruleId === 'module-registry/no-direct-module-import');
  warningCount += msgs.length;
  for (const m of msgs) {
    const match = m.message.match(/模块 "(\w+)"/);
    if (match) {
      const mod = match[1];
      moduleCounts[mod] = (moduleCounts[mod] || 0) + 1;
      if (!fileModuleCounts[mod]) fileModuleCounts[mod] = {};
      const shortPath = file.filePath.replace(/\\/g, '/').replace(/^.*\/src\//, 'src/');
      fileModuleCounts[mod][shortPath] = (fileModuleCounts[mod][shortPath] || 0) + 1;
    }
  }
}

console.log('Total files linted:', data.length);
console.log('Files with module-registry warnings:', modRegistryWarnings.length);
console.log('Total module-registry warnings:', warningCount);
console.log('');

console.log('=== By module (descending) ===');
const sorted = Object.entries(moduleCounts).sort((a, b) => b[1] - a[1]);
let w = 0;
for (const [mod, count] of sorted) {
  console.log(`${mod.padEnd(16)} ${count}`);
  w += count;
}
console.log('');
console.log('Module total:', w);
console.log('');

// Top-affected files per module
console.log('=== Top-5 files per module ===');
for (const [mod, _] of sorted.slice(0, 10)) {
  const files = Object.entries(fileModuleCounts[mod] || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  console.log(`\n${mod} (${moduleCounts[mod]} total):`);
  for (const [f, c] of files) {
    console.log(`  ${f} (${c})`);
  }
}
