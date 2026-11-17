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
 * 未知命令采样（P2-A，2026-11-17）—— 审批缺口的**结构化闭环**。
 *
 * 背景：`auto` 档对未收录命令 fail-closed（ask）；此前 `AutoModeClassifier` 只在日志里
 * 记一条 `permission:unknown_command`，没有消费方 ⇒ 缺口永远收敛不了（真机会话
 * `session_mwk2fakzf30b34b448` 的 19 张审批卡即由此类累计）。
 *
 * 本模块把采样落到本地 JSONL（append-only）：`<pyapp-home>/data/permission/unknown-commands.jsonl`，
 * 每行 `{ head, at, surface }`（surface 截断，去敏到命令名 + 前 120 字符）。
 * 只做**记录**，不参与任何放行判定；评审后由人改白名单/规则（不做运行时自动学习）。
 *
 * 覆盖：`PERMISSION_UNKNOWN_COMMAND_LOG` 可指定文件路径（测试/排障用）。
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { resolvePyappHome } from '@openliri/infra/environment';
import { getLogger } from '@openliri/infra/monitoring';

const logger = getLogger('permission:unknownCommandSamples');

export interface UnknownCommandSample {
  /** 命令名（首个 token，小写，≤60 字符） */
  head: string;
  /** 采样时间（epoch ms） */
  at: number;
  /** 命令原文截断（≤120 字符；仅用于评审归类） */
  surface: string;
}

/** 采样文件路径（env 覆盖优先） */
export function resolveUnknownCommandLogPath(): string {
  const override = process.env.PERMISSION_UNKNOWN_COMMAND_LOG?.trim();
  if (override) return override;
  return join(
    resolvePyappHome(),
    'data',
    'permission',
    'unknown-commands.jsonl'
  );
}

/**
 * 追加一条采样（fire-and-forget；失败只 debug，不影响判定）。
 *
 * 调用方已按 head 做过"每进程一次"去重，此处不再去重（保留跨进程频次）。
 */
export function appendUnknownCommandSample(sample: UnknownCommandSample): void {
  const path = resolveUnknownCommandLogPath();
  void (async () => {
    try {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `${JSON.stringify(sample)}\n`, 'utf8');
    } catch (err) {
      // @ignore-catch — 采样属旁路观测，失败不得影响权限判定（CS03）
      logger.debug('未知命令采样写入失败（忽略）', {
        path,
        error: String(err),
      });
    }
  })();
}
