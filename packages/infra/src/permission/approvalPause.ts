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
 * 「暂停全部持久化放行」开关（R3，2026-11-17；治理方案 §3.4）
 *
 * 出事时一键收紧：开启后 ——
 * 1. **不再新增**审批生成的放行规则（三个审批写入点先查本开关）；
 * 2. **已存在的**审批生成规则不参与判定（`RuleManager#getRulesByBehavior` 过滤）——
 *    规则仍在列表/健康视图里可见、可逐条撤销，不做破坏性删除。
 *
 * 持久化位置：`config.json#permission.pauseApprovalPersistence`（用户显式开启才生效）。
 * 粒度：实例级（本机全局）。会话级 / 工作区级更细的粒度待设置页改造时再拆。
 */
import { configManager } from '@openliri/infra/config';
import { getLogger } from '@openliri/infra/monitoring';

const logger = getLogger('permission:approvalPause');

/** 配置键（`GET /v1/config/permission.pauseApprovalPersistence` 同源） */
export const APPROVAL_PAUSE_CONFIG_KEY = 'permission.pauseApprovalPersistence';

/** 当前是否暂停持久化放行（缺失 / 非布尔 ⇒ 未暂停） */
export function isApprovalPauseEnabled(): boolean {
  const raw = configManager.getValue<unknown>(APPROVAL_PAUSE_CONFIG_KEY);
  return raw === true;
}

/**
 * 设置暂停状态并留审计日志。
 *
 * 规则过滤是**实时读配置**，故无需额外失效缓存；HTTP 层负责广播 `config:changed`。
 */
export function setApprovalPauseEnabled(enabled: boolean): boolean {
  configManager.setValue(APPROVAL_PAUSE_CONFIG_KEY, enabled);
  logger.info('permission:approval_pause_changed', {
    enabled,
    configKey: APPROVAL_PAUSE_CONFIG_KEY,
  });
  return enabled;
}
