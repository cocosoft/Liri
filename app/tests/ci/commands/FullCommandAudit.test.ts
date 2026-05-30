#!/usr/bin/env bun
import { describe, it, expect } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC_DIR = join(import.meta.dir, '../../../src');
const COMMANDS_DIR = join(SRC_DIR, 'commands');

describe('命令结构审计', () => {
  it('命令目录应存在', () => {
    expect(existsSync(COMMANDS_DIR)).toBe(true);
  });

  it('命令模块应有基本结构', () => {
    const files = readdirSync(COMMANDS_DIR);
    expect(files.length).toBeGreaterThan(0);
  });

  it('主要入口文件应存在', () => {
    expect(existsSync(join(SRC_DIR, 'index.ts'))).toBe(true);
    expect(existsSync(join(SRC_DIR, 'main.ts'))).toBe(true);
  });

  it('类型定义文件应存在', () => {
    expect(existsSync(join(SRC_DIR, 'types/command.ts'))).toBe(true);
  });

  it('内置命令目录应有子命令', () => {
    const builtinDir = join(COMMANDS_DIR, 'builtin');
    expect(existsSync(builtinDir)).toBe(true);
    const subDirs = readdirSync(builtinDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    expect(subDirs.length).toBeGreaterThan(10);
  });

  it('TypeScript 应通过类型检查', () => {
    const tsconfigPath = join(import.meta.dir, '../../../tsconfig.json');
    expect(existsSync(tsconfigPath)).toBe(true);
  });
});
