/**
 * P2-1（2026-11-25）：长期记忆索引头部条目读取。
 *
 * 伙伴 `talk` 回响不再全量读记忆文件，改为与系统提示注入同源的 `MEMORY.md` 头部；
 * 这里锁定解析口径与空态（文件缺失 / 无条目 ⇒ 空数组，不伪造）。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readMemoryIndexEntries } from '@openliri/infra/memory';

const dirs: string[] = [];

const makeMemoryDir = (indexContent?: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'liri-mem-index-'));
  dirs.push(dir);
  if (indexContent !== undefined) {
    mkdirSync(join(dir, 'global'), { recursive: true });
    writeFileSync(join(dir, 'global', 'MEMORY.md'), indexContent, 'utf-8');
  }
  return dir;
};

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('readMemoryIndexEntries', () => {
  it('解析索引条目（标题 + 一行钩子），忽略元信息行', () => {
    const dir = makeMemoryDir(
      [
        '# Memory Index',
        '',
        '> 自动生成，勿手改。',
        '共 2 条。',
        '- [用户偏好](pref.md) — 偏好 TypeScript 与严格类型',
        '- [项目约定](conv.md)',
        '',
      ].join('\n')
    );

    const entries = readMemoryIndexEntries({ memoryDir: dir, limit: 5 });
    expect(entries).toEqual([
      { name: '用户偏好', hook: '偏好 TypeScript 与严格类型' },
      { name: '项目约定', hook: '' },
    ]);
  });

  it('limit 截断只读头部', () => {
    const dir = makeMemoryDir(
      ['- [A](a.md) — a', '- [B](b.md) — b', '- [C](c.md) — c'].join('\n')
    );
    expect(readMemoryIndexEntries({ memoryDir: dir, limit: 2 })).toHaveLength(
      2
    );
    expect(readMemoryIndexEntries({ memoryDir: dir, limit: 0 })).toEqual([]);
  });

  it('索引缺失 / 无条目 ⇒ 空数组（不伪造）', () => {
    expect(readMemoryIndexEntries({ memoryDir: makeMemoryDir() })).toEqual([]);
    expect(
      readMemoryIndexEntries({ memoryDir: makeMemoryDir('# Memory Index\n') })
    ).toEqual([]);
  });
});
