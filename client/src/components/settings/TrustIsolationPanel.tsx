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
 * 信任与隔离（PR-3c 收尾，2026-10-23）
 *
 * 把原先三个分散入口合成一页，按设计 §3.9.6 的优先级顺序排列：
 *   ① **信任工作区**（现有面板，语义不变：只影响 bash 是否询问；deny 永不绕过）
 *   ② **沙箱隔离**（`sandbox.enabled` + 默认权限位；默认 `standard`，不含 EXECUTE）
 *   ③ **自动放行审计**（近端 `approval:sandbox|auto|trust` 计数，明细跳安全仪表盘）
 *
 * 一律复用既有服务/纯函数（`sandboxService`、`countApprovalRules`），不新建判定逻辑。
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  sandboxService,
  type SandboxConfig,
  type SandboxPermissionLevel,
} from "../../services/sandboxService";
import {
  APPROVAL_RULES,
  APPROVAL_RULE_LABELS,
  countApprovalRules,
} from "../../utils/approvalRuleLabel";
import TrustedWorkspacesPanel from "./TrustedWorkspacesPanel";

interface TrustIsolationPanelProps {
  isDark: boolean;
}

const PERMISSION_LEVELS: SandboxPermissionLevel[] = [
  "full",
  "standard",
  "readonly",
];

const PERMISSION_LABEL_KEYS: Record<SandboxPermissionLevel, string> = {
  full: "sandbox.permissionFull",
  standard: "sandbox.permissionStandard",
  readonly: "sandbox.permissionReadonly",
};

function TrustIsolationPanel({ isDark }: TrustIsolationPanelProps) {
  const { t } = useTranslation();
  const [sandbox, setSandbox] = useState<SandboxConfig | null>(null);
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const [breakdown, setBreakdown] = useState<{
    total: number;
    byRule: Record<string, number>;
  } | null>(null);

  const card = isDark
    ? "bg-gray-800 border-gray-700"
    : "bg-white border-gray-200";
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-600";

  useEffect(() => {
    void (async () => {
      try {
        setSandbox(await sandboxService.getConfig());
      } catch {
        // 服务不可用 ⇒ 仅隐藏沙箱块（不阻断信任工作区编辑）
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          "/v1/security/audit-logs?decision=auto_allowed&limit=200",
        );
        if (!res.ok) return;
        const events = (await res.json()) as Array<{ matchedRules?: string[] }>;
        if (!cancelled) setBreakdown(countApprovalRules(events));
      } catch {
        // 审计不可用 ⇒ 不显示计数块
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patchSandbox = useCallback(async (patch: Partial<SandboxConfig>) => {
    setSandboxBusy(true);
    try {
      setSandbox(await sandboxService.updateConfig(patch));
    } catch {
      // `sandboxService` 已记录错误；保持旧值（不伪造成功）
    } finally {
      setSandboxBusy(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      {/* ① 信任工作区（语义见横幅：只影响 bash 是否询问） */}
      <TrustedWorkspacesPanel isDark={isDark} />

      {/* ② 沙箱隔离 */}
      {sandbox && (
        <div className={`rounded-lg border p-4 ${card}`}>
          <h3 className={`text-sm font-semibold mb-1 ${textPrimary}`}>
            {t("settings.isolationSandboxTitle")}
          </h3>
          <p className={`text-xs mb-3 ${textSecondary}`}>
            {t("settings.isolationSandboxHint")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void patchSandbox({ enabled: !sandbox.enabled })}
              disabled={sandboxBusy}
              className={`text-xs px-3 py-1.5 rounded ${
                sandbox.enabled
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : isDark
                    ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              } disabled:opacity-50`}
            >
              {sandbox.enabled
                ? t("sandbox.disableSandbox")
                : t("sandbox.enableSandbox")}
            </button>
            {PERMISSION_LEVELS.map((level) => (
              <button
                key={level}
                onClick={() => void patchSandbox({ permissionLevel: level })}
                disabled={sandboxBusy}
                className={`text-xs px-3 py-1.5 rounded border transition-colors disabled:opacity-50 ${
                  sandbox.permissionLevel === level
                    ? isDark
                      ? "bg-blue-900/40 border-blue-600 text-blue-300"
                      : "bg-blue-50 border-blue-500 text-blue-700"
                    : isDark
                      ? "border-gray-600 text-gray-300 hover:border-gray-500"
                      : "border-gray-300 text-gray-700 hover:border-gray-400"
                }`}
              >
                {t(PERMISSION_LABEL_KEYS[level])}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ③ 自动放行审计（近端计数；明细在安全仪表盘） */}
      {breakdown && breakdown.total > 0 && (
        <div className={`rounded-lg border p-4 ${card}`}>
          <div className="flex items-center justify-between mb-2">
            <h3 className={`text-sm font-semibold ${textPrimary}`}>
              {t("settings.isolationAuditTitle")}
            </h3>
            <Link
              to="/security"
              className={`text-xs px-2 py-1 rounded ${isDark ? "bg-gray-700 text-gray-300 hover:bg-gray-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
            >
              {t("settings.isolationAuditDetail")}
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {APPROVAL_RULES.map((rule) => (
              <span
                key={rule}
                className={`text-xs px-2 py-0.5 rounded ${isDark ? "bg-emerald-900/40 text-emerald-300" : "bg-emerald-50 text-emerald-700"}`}
              >
                {t(APPROVAL_RULE_LABELS[rule])}：{breakdown.byRule[rule] ?? 0}
              </span>
            ))}
          </div>
          <p className={`text-xs mt-2 ${textSecondary}`}>
            {t("settings.isolationAuditHint")}
          </p>
        </div>
      )}
    </div>
  );
}

export default TrustIsolationPanel;
