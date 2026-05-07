#!/usr/bin/env bun
/**
 * 批量修复 45 个命令的 this 上下文丢失问题
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const BUILTIN_DIR = join(import.meta.dirname, '..', 'commands', 'builtin');

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else if (entry.name === 'index.ts') {
      results.push(fullPath);
    }
  }
  return results;
}

const files = walkDir(BUILTIN_DIR);
let fixed = 0;

for (const file of files) {
  let content = readFileSync(file, 'utf-8');
  const original = content;

  content = content.replace(
    /\.then\(\(?m\)?\s*=>\s*\(\{\s*execute:\s*m\.default\.execute\s*\}\)\)/g,
    '.then((m) => ({ execute: m.default.execute.bind(m.default) }))'
  );

  if (content !== original) {
    writeFileSync(file, content, 'utf-8');
    console.log(`✓ 修复: ${file.replace(BUILTIN_DIR, 'builtin')}`);
    fixed++;
  }
}

console.log(`\n完成: ${fixed} 个文件已修复`);
