/**
 * KnowledgeScanner delta 行为测试（预存错误 #57-2）
 *
 * 背景：08-12 日志中 `[computeDelta] 读取delta文件失败` ×数百——
 * 旧代码对首次扫描的 ENOENT（delta 文件不存在=正常路径）全部记录 error
 * （K1 修复 08-14 已跳过 ENOENT）；剩余隐患为 saveDelta 直写目标文件，
 * 进程强杀时留半写文件 → 下次 JSON.parse 失败。本测试验证：
 *   1. 首次扫描静默建立基线（无 ENOENT 报错）
 *   2. 内容变更后基线原子更新（文件恒完整）
 *   3. 损坏 delta 自动重建（自愈，不崩溃）
 */

import { describe, test, expect } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { KnowledgeScanner } from '../KnowledgeScanner.js';

function setup(): {
  root: string;
  knowledgeRoot: string;
  deltaDir: string;
  scanner: KnowledgeScanner;
} {
  const root = mkdtempSync(join(tmpdir(), 'knowledge-scanner-'));
  const knowledgeRoot = join(root, 'knowledge');
  const deltaDir = join(root, 'delta');
  mkdirSync(knowledgeRoot, { recursive: true });
  const scanner = new KnowledgeScanner({ knowledgeRoot, deltaDir });
  return { root, knowledgeRoot, deltaDir, scanner };
}

describe('KnowledgeScanner delta（预存错误 #57-2）', () => {
  test('首次扫描建立基线，不抛 ENOENT 错误', async () => {
    const { root, knowledgeRoot, deltaDir, scanner } = setup();
    try {
      writeFileSync(
        join(knowledgeRoot, 'a.md'),
        '---page-break---\n正文',
        'utf-8'
      );
      const files = await scanner.scanChanges(0);
      expect(files).toHaveLength(1);
      expect(files[0].isDelta).toBe(false); // 首次为全量基线

      // delta 基线已建立且为合法 JSON
      const delta = JSON.parse(
        readFileSync(join(deltaDir, 'a.md.json'), 'utf-8')
      );
      expect(delta.fileName).toBe('a.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('内容变更后基线更新，delta 文件恒完整', async () => {
    const { root, knowledgeRoot, deltaDir, scanner } = setup();
    try {
      const file = join(knowledgeRoot, 'a.md');
      writeFileSync(file, '第一行', 'utf-8');
      await scanner.scanChanges(0);

      writeFileSync(file, '第一行\n第二行', 'utf-8');
      await new Promise((r) => setTimeout(r, 20)); // 确保 mtime 变化
      await scanner.scanChanges(0);

      const delta = JSON.parse(
        readFileSync(join(deltaDir, 'a.md.json'), 'utf-8')
      );
      expect(delta.fileName).toBe('a.md');
      expect(typeof delta.baseSnapshot).toBe('string');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('损坏的 delta 文件被自动重建（自愈，不崩溃）', async () => {
    const { root, knowledgeRoot, deltaDir, scanner } = setup();
    try {
      writeFileSync(join(knowledgeRoot, 'a.md'), '正文', 'utf-8');
      await scanner.scanChanges(0);

      // 模拟强杀导致的半写损坏
      writeFileSync(
        join(deltaDir, 'a.md.json'),
        '{"fileName": "a.md",',
        'utf-8'
      );

      // 不应抛异常：JSON.parse 失败 → handleError 记录 → 重建基线自愈
      const files = await scanner.scanChanges(0);
      expect(files).toHaveLength(1);

      const delta = JSON.parse(
        readFileSync(join(deltaDir, 'a.md.json'), 'utf-8')
      );
      expect(delta.fileName).toBe('a.md'); // 已重建为合法 JSON
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('小变更返回行级 diff（增量机制生效）', async () => {
    const { root, knowledgeRoot, scanner } = setup();
    try {
      const file = join(knowledgeRoot, 'a.md');
      // 20 行基线，后续追加 1 行 → 变更比例 ~5%（远小于 50% 阈值）
      const base = Array.from({ length: 20 }, (_, i) => `第${i}行`).join('\n');
      writeFileSync(file, base, 'utf-8');
      await scanner.scanChanges(0);

      writeFileSync(file, `${base}\n新增行`, 'utf-8');
      await new Promise((r) => setTimeout(r, 20));
      const files = await scanner.scanChanges(0);

      expect(files).toHaveLength(1);
      expect(files[0].isDelta).toBe(true);
      expect(files[0].delta?.additions).toContain('新增行');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('旧格式 delta（无 oldLines）自动重建基线', async () => {
    const { root, knowledgeRoot, deltaDir, scanner } = setup();
    try {
      const file = join(knowledgeRoot, 'a.md');
      writeFileSync(file, '第一行', 'utf-8');
      await scanner.scanChanges(0);

      // 模拟升级前旧格式 delta（无 oldLines 字段）
      writeFileSync(
        join(deltaDir, 'a.md.json'),
        JSON.stringify({
          fileName: 'a.md',
          baseSnapshot: 'x',
          additions: [],
          removals: [],
          lastCheckedAt: 1,
        }),
        'utf-8'
      );

      writeFileSync(file, '第一行\n第二行', 'utf-8');
      await new Promise((r) => setTimeout(r, 20));
      const files = await scanner.scanChanges(0);

      expect(files).toHaveLength(1);
      expect(files[0].isDelta).toBe(false); // 旧格式 → 重建基线 → 全量读

      // 已升级为新格式（含 oldLines）
      const delta = JSON.parse(
        readFileSync(join(deltaDir, 'a.md.json'), 'utf-8')
      );
      expect(Array.isArray(delta.oldLines)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
