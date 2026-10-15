// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// USD 台账「模型参」源码守卫（2026-10-15）：
//
// 缺陷（真机实证）：CLI 对话路径 `commands/builtin/chat/Chat.ts` 调
// `recordDailyBudgetFromUsage({ inputTokens, outputTokens })` **未传第 3 参 `model`** ⇒
// `recordTurnCostUsd` 因模型不可得而跳过金额记账（且原为 debug 级、不可见）⇒ 当日 USD 台账
// `usedUsd=$0.863` 仅为计费侧 `$3.6866` 的 **29%**（漏记 71%）。
//
// 同源要求：同一处上方已有 `costTracker.addCost(model, ...)` 的同一模型值 ⇒ 必须复用（CS01「数出同源」）。
// 本守卫钉住"CLI 两处调用必须带 model"，防回流。

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const CHAT_CMD = join(
  __dirname,
  '..',
  '..',
  'src',
  'commands',
  'builtin',
  'chat',
  'Chat.ts'
);

const STREAM_PIPELINE = join(
  __dirname,
  '..',
  '..',
  'src',
  'chat',
  'pipeline',
  'StreamPipeline.ts'
);

describe('USD 台账模型参守卫（CLI 对话路径）', () => {
  const src = readFileSync(CHAT_CMD, 'utf-8');

  it('① `recordDailyBudgetFromUsage` 两处调用均带第 3 参 model（同源于同处 addCost）', () => {
    const withModel =
      src.match(
        /recordDailyBudgetFromUsage\(\s*\{ inputTokens, outputTokens \}\s*,\s*undefined\s*,\s*model\s*\)/g
      ) ?? [];
    expect(withModel.length).toBe(2);
  });

  it('② 负向：不存在"缺 model 参"的调用形态（防回流）', () => {
    const missing =
      src.match(
        /recordDailyBudgetFromUsage\(\s*\{ inputTokens, outputTokens \}\s*\)/g
      ) ?? [];
    expect(missing.length).toBe(0);
  });
});

/**
 * **流式主链**（客户端主路径）同族缺陷（2026-10-15 真机 E2E 实证）。
 *
 * `StreamPipeline.recordUsage` 原为
 * `this.ctx.recordChatResponseUsage(session.id, finalResponse?.usage, this.ctx.requestId)`
 * —— **漏传第 4 参 `model`** ⇒ `ChatManager.recordChatResponseUsage` → `recordTurnCostUsd`
 * 因模型不可得而跳过金额记账（`dailyBudget:usd_skip`）⇒ `usedUsd` 在**主链**出现缺口。
 * 真机证据：一句 “ping” 的真实调用 `usage.prompt_tokens=12700 / completion=12`，
 * `todayUsed` 正确 +12,712，而 `usedUsd` **纹丝不动**（$0）。债四 S3 后该缺口升级为
 * **闸门漏判**（USD 为唯一硬闸门）。
 */
describe('USD 台账模型参守卫（流式主链 StreamPipeline）', () => {
  const src = readFileSync(STREAM_PIPELINE, 'utf-8');

  it('① `recordChatResponseUsage` 必须带第 4 参 model', () => {
    const withModel =
      src.match(
        /recordChatResponseUsage\(\s*session\.id,\s*finalResponse\?\.usage,\s*this\.ctx\.requestId,\s*turnModel\s*\)/g
      ) ?? [];
    expect(withModel.length).toBe(1);
  });

  it('② 负向：不得存在只传 3 参的形态（防回流）', () => {
    const missing =
      src.match(
        /recordChatResponseUsage\(\s*session\.id,\s*finalResponse\?\.usage,\s*this\.ctx\.requestId\s*\)/g
      ) ?? [];
    expect(missing.length).toBe(0);
  });

  it('③ 数出同源：`turnModel` 同时喂给金额台账与 `trackUsage`（单一取值点）', () => {
    const resolveOnce =
      src.match(/const turnModel = extractModelFromResponse\(/g) ?? [];
    expect(resolveOnce.length).toBe(1);
    // 两处消费者复用同一值 ⇒ 不得再出现第二处内联 `extractModelFromResponse(` 调用
    const inline = src.match(/model:\s*extractModelFromResponse\(/g) ?? [];
    expect(inline.length).toBe(0);
  });
});
