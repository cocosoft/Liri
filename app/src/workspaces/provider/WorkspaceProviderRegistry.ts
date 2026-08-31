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
 * WorkspaceProviderRegistry — 隔离 provider 注册表（G2，对标 PilotDeck）
 *
 * 按 priority 升序注册；resolve 时选第一个 isApplicable 的 provider。
 * 选择纯自动（git-worktree=1 > snapshot-copy=2），不读配置策略。
 */
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import type {
  WorkspaceHandle,
  WorkspacePrepareInput,
  WorkspaceProvider,
  WorkspacePublishOutput,
  WorkspaceStrategyId,
} from './WorkspaceProvider';

export class WorkspaceProviderRegistry {
  private readonly providers: WorkspaceProvider[] = [];

  add(provider: WorkspaceProvider): void {
    this.providers.push(provider);
    this.providers.sort((a, b) => a.priority - b.priority);
  }

  list(): readonly WorkspaceProvider[] {
    return this.providers;
  }

  /** 按优先级选第一个适用的 provider */
  async resolve(projectRoot: string): Promise<WorkspaceProvider> {
    for (const provider of this.providers) {
      try {
        if (await provider.isApplicable(projectRoot)) {
          return provider;
        }
      } catch {
        // 尝试下一个 provider
      }
    }
    throw new AppError(
      `无适用隔离 provider（projectRoot=${projectRoot}）`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      'WORKSPACE_PROVIDER_UNAVAILABLE'
    );
  }

  /** resolve + prepare 组合 */
  async prepare(input: WorkspacePrepareInput): Promise<{
    handle: WorkspaceHandle;
    provider: WorkspaceProvider;
  }> {
    const provider = await this.resolve(input.projectRoot);
    const handle = await provider.prepare(input);
    return { handle, provider };
  }

  /** resolve + prepare + publish 组合（创建隔离区并回灌） */
  async prepareAndPublish(
    input: WorkspacePrepareInput
  ): Promise<WorkspacePublishOutput> {
    const { handle, provider } = await this.prepare(input);
    try {
      return await provider.publish(handle);
    } finally {
      await provider.dispose(handle, { keep: false });
    }
  }

  findById(id: WorkspaceStrategyId): WorkspaceProvider | undefined {
    return this.providers.find((p) => p.id === id);
  }
}
