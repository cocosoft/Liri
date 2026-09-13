// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// K5 内容指纹 + 血缘/版本：digest 决策、LineageStore 写入/反查/版本、幂等。

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  computeTextDigest,
  computeFileDigest,
  shouldRecompileByFingerprint,
} from '../lineage/contentFingerprint';
import { LineageStore } from '../lineage/LineageStore';

let dir: string;
let store: LineageStore | undefined;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'k5-lineage-test-'));
});

afterAll(async () => {
  await store?.close();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 句柄释放延迟导致残留时忽略
  }
});

describe('K5 内容指纹（digest）', () => {
  it('文本摘要稳定且随内容变化', () => {
    const a = computeTextDigest('严禁硬编码密钥');
    expect(a).toBe(computeTextDigest('严禁硬编码密钥'));
    expect(a).not.toBe(computeTextDigest('严禁硬编码口令'));
  });

  it('文件字节摘要（同 mtime 内容变仍可识别）', async () => {
    const file = join(dir, 'doc.md');
    const { writeFile } = await import('fs/promises');
    await writeFile(file, 'v1 内容', 'utf-8');
    const d1 = await computeFileDigest(file);
    // 内容改变但 mtime 用原时间（模拟 touch 保留 mtime 的场景）
    const prevStat = await (await import('fs/promises')).stat(file);
    await writeFile(file, 'v2 内容不同', 'utf-8');
    await (
      await import('fs/promises')
    ).utimes(file, prevStat.atime, prevStat.mtime);
    const d2 = await computeFileDigest(file);
    expect(d1).not.toBe(d2);
  });

  it('决策：无历史或相同 → 不重编译；不同 → 重编译', () => {
    expect(shouldRecompileByFingerprint(undefined, 'x')).toBe(false);
    expect(shouldRecompileByFingerprint('same', 'same')).toBe(false);
    expect(shouldRecompileByFingerprint('old', 'new')).toBe(true);
  });
});

describe('K5 LineageStore（血缘/版本/反查）', () => {
  beforeAll(() => {
    store = new LineageStore(join(dir, 'lineage.db'));
  });

  it('addLinks 幂等 + 按 doc 反查产物', async () => {
    await store!.init();
    const doc = 'C:/raw/御数坊-AiDGAtlas知识工厂-v1.0.pdf';
    await store!.addLinks(
      doc,
      [{ artifactType: 'page', artifactId: 'p1.md' }],
      1
    );
    await store!.addLinks(
      doc,
      [{ artifactType: 'page', artifactId: 'p1.md' }],
      1
    );
    await store!.addLinks(
      doc,
      [{ artifactType: 'page', artifactId: 'p2.md' }],
      1
    );

    const links = await store!.findArtifactsByDoc(doc);
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.version === 1)).toBe(true);

    // 反查：page → doc
    const docs = await store!.findDocsByArtifact('page', 'p2.md');
    expect(docs.length).toBe(1);
    expect(docs[0].docPath).toBe(doc);
  });

  it('版本过滤 + record/rule 产物共存', async () => {
    const doc = 'C:/wiki/summary.md';
    await store!.addLinks(
      doc,
      [
        { artifactType: 'record', artifactId: 'contract:HT-1' },
        { artifactType: 'rule', artifactId: 'policy:abc' },
      ],
      7
    );
    const v7 = await store!.query({ docPath: doc, version: 7 });
    expect(v7.length).toBe(2);
    const records = await store!.query({
      docPath: doc,
      artifactType: 'record',
    });
    expect(records.length).toBe(1);
  });

  it('purgeByDoc 清理该 doc 血缘', async () => {
    const doc = 'C:/raw/cleanup.pdf';
    await store!.addLinks(
      doc,
      [{ artifactType: 'page', artifactId: 'c.md' }],
      2
    );
    const removed = await store!.purgeByDoc(doc);
    expect(removed).toBeGreaterThan(0);
    expect(await store!.findArtifactsByDoc(doc)).toHaveLength(0);
  });
});
