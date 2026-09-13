// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// K2 本体驱动：值域/主键校验、records.yaml 加载、RecordStore 落库去重测试。

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { RecordSchema, FieldDef } from '../schema/SchemaLoader';
import { SchemaLoader } from '../schema/SchemaLoader';
import { RecordStore } from '../record/RecordStore';

let dir: string;
let store: RecordStore | undefined;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'k2-record-test-'));
});

afterAll(async () => {
  await store?.close();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      // Windows 下 SQLite 句柄释放有延迟，短暂重试
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // 极端情况下残留临时目录不影响测试结果
  }
});

const contractSchema: RecordSchema = {
  type: 'contract',
  displayName: '合同',
  description: '业务合同',
  primaryKey: 'contractNo',
  fields: {
    contractNo: {
      type: 'string',
      required: true,
      regex: '^HT-\\d{4,}$',
      description: '合同编号',
    },
    partyA: { type: 'string', required: true },
    amount: {
      type: 'number',
      required: true,
      range: { min: 0, max: 100000000 },
    },
    status: {
      type: 'string',
      required: true,
      enum: ['签署中', '已签署', '已终止'],
    },
  } satisfies Record<string, FieldDef>,
};

describe('K2 validateRecord（值域 + 主键）', () => {
  const loader = new SchemaLoader(dir);

  it('合法记录通过', () => {
    const r = loader.validateRecord(contractSchema, {
      contractNo: 'HT-2026001',
      partyA: '御数坊',
      amount: 200000,
      status: '已签署',
    });
    expect(r.valid).toBe(true);
  });

  it('主键缺失/为空 → 必填失败', () => {
    const r = loader.validateRecord(contractSchema, {
      partyA: '甲方',
      amount: 1,
      status: '签署中',
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(';')).toContain('contractNo');
  });

  it('主键格式不符合 regex → 失败', () => {
    const r = loader.validateRecord(contractSchema, {
      contractNo: 'ABC-1',
      partyA: '甲方',
      amount: 1,
      status: '签署中',
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(';')).toContain('正则校验失败');
  });

  it('enum 值域外 → 失败', () => {
    const r = loader.validateRecord(contractSchema, {
      contractNo: 'HT-2026001',
      partyA: '甲方',
      amount: 1,
      status: '已作废',
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(';')).toContain('值域校验失败');
  });

  it('range 越界 → 失败', () => {
    const r = loader.validateRecord(contractSchema, {
      contractNo: 'HT-2026001',
      partyA: '甲方',
      amount: -5,
      status: '签署中',
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(';')).toContain('下限');
  });
});

describe('K2 loadRecords / validateEntity 值域', () => {
  it('从 records.yaml 加载记录类型（非法定义跳过）', async () => {
    writeFileSync(
      join(dir, 'records.yaml'),
      [
        'records:',
        '  - type: contract',
        '    displayName: 合同',
        '    description: 业务合同',
        '    primaryKey: contractNo',
        '    fields:',
        '      contractNo: { type: string, required: true }',
        '  - type: broken-record',
        '    displayName: 缺主键定义',
        '    description: 非法示例',
        '    fields:',
        '      x: { type: string }',
      ].join('\n'),
      'utf-8'
    );

    const loader = new SchemaLoader(dir);
    const records = await loader.loadRecords();
    expect(records.has('contract')).toBe(true);
    expect(records.has('broken-record')).toBe(false);
  });

  it('validateEntity 值域（enum/regex/range）随字段校验生效', () => {
    const loader = new SchemaLoader(dir);
    const entities = new Map([
      [
        'person',
        {
          kind: 'person',
          displayName: '人物',
          description: '',
          fields: {
            name: {
              type: 'string',
              required: true,
              regex: '^[\\u4e00-\\u9fa5]{2,8}$',
            },
            age: { type: 'number', range: { min: 0, max: 150 } },
          },
        },
      ],
    ]);

    const ok = loader.validateEntity(
      'person',
      { name: '张三', age: 30 },
      entities
    );
    expect(ok.valid).toBe(true);

    const badName = loader.validateEntity(
      'person',
      { name: 'abc', age: 30 },
      entities
    );
    expect(badName.valid).toBe(false);

    const badAge = loader.validateEntity(
      'person',
      { name: '张三', age: 200 },
      entities
    );
    expect(badAge.valid).toBe(false);
    expect(badAge.errors.join(';')).toContain('上限');
  });
});

describe('K2 RecordStore（落库/去重/检索）', () => {
  beforeAll(() => {
    const dbFile = join(dir, 'records.db');
    store = new RecordStore(dbFile);
  });

  it('同主键 upsert 去重并更新', async () => {
    await store!.init();
    await store!.upsert({
      type: 'contract',
      key: 'HT-2026001',
      data: { contractNo: 'HT-2026001', status: '签署中', amount: 100 },
      evidence: { contractNo: 'HT-2026001 合同' },
      sourceFile: 'a.md',
    });
    await store!.upsert({
      type: 'contract',
      key: 'HT-2026001',
      data: { contractNo: 'HT-2026001', status: '已签署', amount: 100 },
      evidence: {},
      sourceFile: 'a.md',
    });
    const n = await store!.count('contract');
    expect(n).toBe(1);
    const found = await store!.search('HT-2026001', { type: 'contract' });
    expect(found.length).toBe(1);
    expect(found[0].data.status).toBe('已签署');
    expect(found[0].id).toBe('contract:HT-2026001');
  });

  it('deleteBySource 清理该来源全部记录', async () => {
    await store!.upsert({
      type: 'contract',
      key: 'HT-2026002',
      data: { contractNo: 'HT-2026002' },
      sourceFile: 'b.md',
    });
    const deleted = await store!.deleteBySource('b.md');
    expect(deleted).toBe(1);
    const rest = await store!.count('contract');
    expect(rest).toBe(1); // 仅剩 a.md 那条
  });
});
