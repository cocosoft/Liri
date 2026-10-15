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
