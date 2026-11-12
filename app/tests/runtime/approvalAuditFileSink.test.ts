/**
 * G4 围栏 M0-④（2026-11-12）：审批四段事件的文件落盘（JSONL）。
 *
 * 契约：
 * ① 每行是完整 JSON（含 `at` / `sessionId` / 事件本体字段），append-only 不互相覆盖；
 * ② 目录不存在时自动创建（围栏无需关心目录是否已建）；
 * ③ 开关关闭 ⇒ sink 不会被调用 ⇒ 不建文件（该判定在 `emitApprovalAudit` 内，本用例不重复造）。
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendApprovalAuditLine,
  buildApprovalAuditLine,
} from '@openliri/service/runtime/api/approvalAuditFileSink';
import type { ApprovalAuditEvent } from '@openliri/infra/permission';

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'approval-audit-'));
  tmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

const REQUESTED: ApprovalAuditEvent = {
  stage: 'requested',
  approvalId: 'ap_abc_1',
  toolName: 'bash',
  risk: 'high',
  inputPreview: 'rm -rf /tmp/x',
};

describe('M0-④：审批四段文件落盘', () => {
  it('行内容为完整 JSON（at / sessionId / 事件字段），无补造字段', () => {
    const line = buildApprovalAuditLine(
      'sess-1',
      REQUESTED,
      new Date('2026-11-12T10:00:00.000Z')
    );
    expect(line.endsWith('\n')).toBe(true);

    const parsed = JSON.parse(line.trim());
    expect(parsed).toEqual({
      at: '2026-11-12T10:00:00.000Z',
      sessionId: 'sess-1',
      ...REQUESTED,
    });
  });

  it('追加写：目录自动创建、两次写入为两行且都可解析', async () => {
    const dir = makeTmpDir();
    const targetPath = join(dir, 'nested', 'approval-audit.jsonl');

    await appendApprovalAuditLine(
      buildApprovalAuditLine('sess-1', REQUESTED),
      targetPath
    );
    await appendApprovalAuditLine(
      buildApprovalAuditLine('sess-1', {
        stage: 'decided',
        approvalId: 'ap_abc_1',
        decision: 'deny',
        by: 'user',
      }),
      targetPath
    );

    const lines = readFileSync(targetPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] as string).stage).toBe('requested');
    expect(JSON.parse(lines[1] as string).stage).toBe('decided');
    expect(JSON.parse(lines[1] as string).decision).toBe('deny');
  });
});
