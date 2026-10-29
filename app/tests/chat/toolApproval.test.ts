// MIT License
// Copyright (c) 2026 190615273@qq.com

// issue #17 · D8（2026-10-29）：工具审批外移后的**守卫语义**回归。
//
// 说明（如实）：审批链路的完整决策（ask / deny / allow / 放行缓存命中）由
// `tests/chat/ChatManagerPermission.test.ts` 现有 6 例端到端覆盖（迁移前后均绿）；
// 本文件只补「不查放行缓存」的**短路分支**，全部为纯函数调用、无 IO、无 mock。

import { describe, it, expect } from 'bun:test';
import { isCommandApproved } from '../../src/chat/manager/toolApproval.js';

describe('isCommandApproved：短路分支（迁移后语义不变）', () => {
  it('命令类工具 + 无 command ⇒ false（不查放行缓存）', async () => {
    expect(await isCommandApproved('bash', {}, 'sess-1')).toBe(false);
  });

  it('命令类工具 + 有 command 但无 session ⇒ false', async () => {
    expect(
      await isCommandApproved('bash', { command: 'echo hi' }, undefined)
    ).toBe(false);
  });

  it('非命令类工具 + 无 session ⇒ false（不得误放行）', async () => {
    expect(
      await isCommandApproved('file_write', { path: '/tmp/a' }, undefined)
    ).toBe(false);
  });
});
