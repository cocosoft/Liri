// MIT License
// Copyright (c) 2026 190615273@qq.com

// issue #16（2026-10-29）：装配宿主端口的**契约守卫**回归。
//
// 背景：`ChatManager` 的构造期装配端口取自其**私有成员**，跨模块无法做结构校验；
// 该守卫把「私有成员改名/删除 ⇒ 运行时 undefined」的静默失效改为**装配期立即抛错并点名缺失键**。
//
// 覆盖：
// ① 缺失键 ⇒ 抛错且报错文本包含缺失键与作用域名（负向验证：等价于私有成员被改名）；
// ② 原型方法计入存在性（`key in host`）——避免"方法在原型上、字段在实例上"的漏判；
// ③ 值尚未赋值但键存在（如 `llmClient`）⇒ **不**误报；
// ④ `asWiringHost` 为纯断言（返回同一引用）；
// ⑤ 集成：真实构造 `ChatManagerImpl` 不触发守卫（等价于两模块的键表与实现一致）。

import { describe, it, expect } from 'bun:test';
import {
  asWiringHost,
  assertHostSurface,
} from '../../src/chat/manager/wiringHostGuard.js';
import { ChatManagerImpl } from '../../src/chat/ChatManager.js';

class FakeHost {
  field = 1;
  deferred: string | undefined;
  method(): string {
    return 'ok';
  }
}

describe('wiringHostGuard：装配契约守卫', () => {
  it('缺失键 ⇒ 抛错，且报错点名缺失键与作用域（负向验证：等价于私有成员被改名）', () => {
    const host = new FakeHost();
    expect(() =>
      assertHostSurface(host, ['field', 'renamedMember'], 'wireChatFacades')
    ).toThrow(/wireChatFacades: 宿主端口缺失 \[renamedMember\]/);
  });

  it('原型方法计入存在性（`key in host`），不误报', () => {
    expect(() =>
      assertHostSurface(new FakeHost(), ['field', 'method'], 'scope')
    ).not.toThrow();
  });

  it('键存在但值为 undefined（构造期尚未赋值）⇒ 不误报', () => {
    const host = new FakeHost();
    host.deferred = undefined;
    expect(() => assertHostSurface(host, ['deferred'], 'scope')).not.toThrow();
  });

  it('asWiringHost 为纯断言：返回同一引用', () => {
    const host = new FakeHost();
    expect(asWiringHost<{ field: number }>(host)).toBe(host);
  });

  it('集成：真实构造 ChatManagerImpl 时两个装配模块的键表与实际宿主一致（守卫不抛）', () => {
    expect(() => new ChatManagerImpl()).not.toThrow();
  });
});
