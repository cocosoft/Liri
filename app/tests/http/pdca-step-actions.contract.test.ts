// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `POST /v1/pdca/:taskId/step/:stepId/{review,decide}` 契约（2026-11-07 真机修复）。
 *
 * 缺陷（真机 `pdca_mw6f842k`）：
 *   ① `decide` 把请求体 `decision` 原样透传 —— 非法值（实测 `bogus`）被写进
 *      `plan.steps[].decision`，接口仍回 `200 {ok:true}`（假成功 + 状态污染）；
 *   ② 编排器未装载时回 `200 {error:'Not available'}`，调用方无法区分成功与没做事。
 *
 * 现口径：非法/缺失 decision ⇒ 400；任务未装载（不存在）⇒ 404；真正执行 ⇒ 200。
 * 隔离 `LIRI_HOME` / `LIRI_DATA_DIR`（与 `pdca-confirm.contract.test.ts` 同法）。
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import type http from 'http';

const isolateDir = mkdtempSync(join(tmpdir(), 'pdca-step-actions-'));
const prevLiriHome = process.env.LIRI_HOME;
const prevLiriDataDir = process.env.LIRI_DATA_DIR;
process.env.LIRI_HOME = isolateDir;
process.env.LIRI_DATA_DIR = isolateDir;

afterAll(() => {
  if (prevLiriHome === undefined) delete process.env.LIRI_HOME;
  else process.env.LIRI_HOME = prevLiriHome;
  if (prevLiriDataDir === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = prevLiriDataDir;
  try {
    rmSync(isolateDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {
    // Windows 偶发 EBUSY：临时目录由系统清理
  }
});

const { handlePdcaReviewStep, handlePdcaDecideStep, handlePdcaAudit } =
  await import('../../src/infrastructure/http/handlers/pdca-handlers');
const { persistAuditReportFile } =
  await import('../../src/tasks/lro/reporting');

function createRes(): {
  res: http.ServerResponse;
  read: () => { status: number; body: Record<string, unknown> };
} {
  const out = { body: '', status: 0 };
  const res = {
    writeHead: (code: number) => {
      out.status = code;
    },
    end: (chunk?: string) => {
      out.body = chunk ?? '';
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    read: () => ({
      status: out.status,
      body: JSON.parse(out.body) as Record<string, unknown>,
    }),
  };
}

function makeReq(body?: unknown): http.IncomingMessage {
  return makeRawReq(body === undefined ? '' : JSON.stringify(body));
}

function makeRawReq(raw: string): http.IncomingMessage {
  const req = new Readable({ read() {} }) as unknown as http.IncomingMessage & {
    headers: Record<string, string>;
  };
  req.headers = { host: 'localhost' };
  if (raw) req.push(raw);
  req.push(null);
  return req;
}

async function decide(taskId: string, body?: unknown) {
  const created = createRes();
  await handlePdcaDecideStep(makeReq(body), created.res, taskId, 'step_1');
  return created.read();
}

async function review(taskId: string) {
  const created = createRes();
  await handlePdcaReviewStep(makeReq(), created.res, taskId, 'step_1');
  return created.read();
}

async function audit(taskId: string) {
  const created = createRes();
  await handlePdcaAudit(makeReq(), created.res, taskId);
  return created.read();
}

describe('POST /v1/pdca/:taskId/step/:stepId/decide 契约', () => {
  test('非法 decision ⇒ 400（不再把 bogus 写进计划）', async () => {
    const { status, body } = await decide('pdca_decide_probe', {
      decision: 'bogus',
    });
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('invalid_decision');
    expect(body.decision).toBe('bogus');
    expect(Array.isArray(body.allowed)).toBe(true);
  });

  test('缺失 decision ⇒ 400', async () => {
    const { status, body } = await decide('pdca_decide_probe', {});
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_decision');
  });

  test('请求体不是合法 JSON ⇒ 400（而非 500）', async () => {
    const created = createRes();
    await handlePdcaDecideStep(
      makeRawReq('not-json'),
      created.res,
      'pdca_decide_probe',
      'step_1'
    );
    const { status, body } = created.read();
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_decision');
  });

  test('合法 decision 但任务未装载 ⇒ 404 not_found（原为 200 假成功）', async () => {
    const { status, body } = await decide('pdca_decide_missing_xyz', {
      decision: 'approved',
    });
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('not_found');
    expect(body.taskId).toBe('pdca_decide_missing_xyz');
  });
});

describe('POST /v1/pdca/:taskId/step/:stepId/review 契约', () => {
  test('任务未装载 ⇒ 404 not_found（原为 200 {error:Not available}）', async () => {
    const { status, body } = await review('pdca_review_missing_xyz');
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('not_found');
  });
});

describe('GET /v1/pdca/:taskId/audit 契约（重启后恢复）', () => {
  const persistedTaskId = 'pdca_audit_persisted';

  test('落盘报告存在（编排器未装载）⇒ 200 返回真实报告', async () => {
    persistAuditReportFile({
      taskId: persistedTaskId,
      planId: 'plan_audit_1',
      totalSteps: 1,
      completedSteps: 1,
      failedSteps: 0,
      skippedSteps: 0,
      totalDurationMs: 12,
      totalRetries: 0,
      steps: [],
      summary: '审计报告（落盘恢复）',
      generatedAt: 1,
    });

    const { status, body } = await audit(persistedTaskId);
    expect(status).toBe(200);
    expect(body.taskId).toBe(persistedTaskId);
    expect(body.summary).toBe('审计报告（落盘恢复）');
  });

  test('既无编排器也无落盘报告 ⇒ 404 not_found', async () => {
    const { status, body } = await audit('pdca_audit_missing_xyz');
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('not_found');
  });
});
