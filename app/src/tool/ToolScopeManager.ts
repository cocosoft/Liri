// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * ToolScopeManager — 工具调用两层副作用作用域（T1.4）
 *
 * 会话级 scope（会话真正销毁/删除时 dispose）
 *   └── 工具级 scope（单次工具执行结束时 dispose）
 *         ├── 短生命周期副作用（写文件、起进程）→ 工具级
 *         └── 长生命周期副作用（事件订阅、常驻进程）→ 提升到会话级
 *
 * 会话锚点（v4）：会话级 scope 锚定"会话真正销毁/删除"而非"会话切换"——
 * 切换离开 ≠ 销毁，切回仍 ACTIVE；订阅类副作用跨切换存活。
 *
 * 工具内访问：startToolScope 用 AsyncLocalStorage 暴露当前工具级 scope，
 * 工具内部通过 getCurrentToolScope() 登记短生命周期副作用；
 * 长生命周期副作用显式通过 getSessionScope(sessionId) 提升登记。
 */

import { AsyncLocalStorage } from 'async_hooks';
import { EffectScope } from '@modules/context';
import { handleError } from '@modules/error/handleError';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tool:scope');

export class ToolScopeManager {
  private sessionScopes = new Map<string, EffectScope>();
  private currentScope = new AsyncLocalStorage<EffectScope | undefined>();

  /**
   * 获取（或惰性创建）会话级 scope。
   * 会话销毁前持续存活；切换会话不 dispose。
   */
  getSessionScope(sessionId: string): EffectScope {
    let scope = this.sessionScopes.get(sessionId);
    if (!scope) {
      scope = new EffectScope();
      this.sessionScopes.set(sessionId, scope);
      logger.debug(`创建会话级 scope: ${sessionId}`);
    }
    return scope;
  }

  /**
   * 开始一次工具执行：创建工具级 scope（会话级子 scope）
   * 并通过 AsyncLocalStorage 暴露为当前工具级 scope。
   * 工具执行结束必须调用 endToolScope()。
   */
  startToolScope(sessionId: string): EffectScope {
    const toolScope = this.getSessionScope(sessionId).child();
    this.currentScope.enterWith(toolScope);
    return toolScope;
  }

  /**
   * 结束一次工具执行：dispose 工具级 scope（短生命周期副作用释放）。
   * dispose 失败仅上报，不阻断工具结果返回。
   */
  async endToolScope(toolScope: EffectScope): Promise<void> {
    this.currentScope.enterWith(undefined);
    try {
      await toolScope.dispose();
    } catch (error) {
      logger.error('工具级 scope dispose 失败', { error: String(error) });
      await handleError(error, {
        module: 'tool:scope',
        action: 'endToolScope',
      });
    }
  }

  /**
   * 当前工具执行内的工具级 scope（无工具执行时返回 undefined）。
   * 工具内部登记短生命周期副作用用：ctx.getCurrentToolScope()?.onDispose(...)。
   */
  getCurrentToolScope(): EffectScope | undefined {
    return this.currentScope.getStore();
  }

  /**
   * 会话销毁：dispose 会话级 scope（回收全部工具级残留与长生命周期副作用）。
   * 幂等：会话 scope 不存在则静默跳过。
   */
  async disposeSession(sessionId: string): Promise<void> {
    const scope = this.sessionScopes.get(sessionId);
    if (!scope) return;
    this.sessionScopes.delete(sessionId);
    try {
      await scope.dispose();
      logger.debug(`会话级 scope 已释放: ${sessionId}`);
    } catch (error) {
      logger.error('会话级 scope dispose 失败', {
        sessionId,
        error: String(error),
      });
    }
  }

  /** 会话级 scope 是否存活（供框架查询，非业务判断） */
  hasSessionScope(sessionId: string): boolean {
    return this.sessionScopes.has(sessionId);
  }
}

/** 全局单例 */
export const toolScopeManager = new ToolScopeManager();
