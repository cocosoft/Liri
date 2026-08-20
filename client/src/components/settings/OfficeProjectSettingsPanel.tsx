/**
 * OfficeProjectSettingsPanel — 办公/项目设置面板（设置模块「办公」项）
 *
 * 统一展示办公相关配置与状态：
 * - OfficeCLI 状态卡片（未安装 / 已安装（版本）/ 版本不兼容）+ 一键安装
 * - 协作式文档生成开关（docWorkflow.staged）
 * - 协商式执行引擎开关 + 门控强度（negotiation.enabled + tier）
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConfigSection,
  ConfigItem,
  ToggleConfig,
  SelectConfig,
} from "./ConfigComponents";
import { officeService } from "../../services/officeService";
import { useConfigStore } from "../../stores/configStore";
import { handleClientError } from "../../utils/handleError";
import type { OfficeCliInstallStatus } from "../../types/office";

interface OfficeProjectSettingsPanelProps {
  isDark: boolean;
}

function OfficeProjectSettingsPanel({
  isDark,
}: OfficeProjectSettingsPanelProps) {
  const [status, setStatus] = useState<OfficeCliInstallStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 协作配置
  const { config, setConfig } = useConfigStore();
  const docWorkflow = (config.docWorkflow ?? {
    staged: true,
    defaultFormat: "docx",
    imageConcurrency: 3,
    outlineConfirmTimeoutMs: 0,
    degradeOnImageFailure: true,
  }) as {
    staged: boolean;
    defaultFormat: string;
    imageConcurrency: number;
    outlineConfirmTimeoutMs: number;
    degradeOnImageFailure: boolean;
  };
  const negotiation = (config.negotiation ?? {
    enabled: true,
    tier: "moderate",
    responseTimeoutMs: 300000,
    autoDegradeOnTimeout: true,
  }) as {
    enabled: boolean;
    tier: string;
    responseTimeoutMs: number;
    autoDegradeOnTimeout: boolean;
  };

  const updateDocWorkflow = (key: string, value: unknown) => {
    void setConfig("docWorkflow", { ...docWorkflow, [key]: value });
  };
  const updateNegotiation = (key: string, value: unknown) => {
    void setConfig("negotiation", { ...negotiation, [key]: value });
  };

  const loadStatus = useCallback(async () => {
    try {
      const res = await officeService.getOfficeCLIStatus();
      const data = (
        res as unknown as { data?: { data?: OfficeCliInstallStatus } }
      )?.data?.data as unknown as OfficeCliInstallStatus | undefined;
      setStatus(data ?? null);
    } catch (e) {
      handleClientError(e, {
        module: "settings:office",
        action: "load_status",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [loadStatus]);

  useEffect(() => {
    if (status?.state === "running") {
      if (!timerRef.current) {
        timerRef.current = setInterval(() => {
          void loadStatus();
        }, 2000);
      }
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [status?.state, loadStatus]);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await officeService.installOfficeCLI();
      await loadStatus();
    } catch (e) {
      handleClientError(e, { module: "settings:office", action: "install" });
    } finally {
      setInstalling(false);
    }
  };

  if (loading) {
    return (
      <div className={`p-6 ${isDark ? "text-gray-400" : "text-gray-500"}`}>
        加载中…
      </div>
    );
  }

  const info = status?.info;
  const state = status?.state ?? "idle";
  const installed = !!info?.installed && !info?.incompatible;

  const badge =
    state === "running"
      ? {
          text: "安装中…",
          cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
        }
      : installed
        ? {
            text: "已就绪",
            cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
          }
        : info?.incompatible
          ? {
              text: "版本不兼容",
              cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
            }
          : {
              text: "未安装",
              cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
            };

  return (
    <>
      {/* OfficeCLI 安装管理 */}
      <ConfigSection
        title="办公能力"
        description="文档生成依赖的 OfficeCLI 工具管理"
        isDark={isDark}
      >
        <ConfigItem
          label="OfficeCLI"
          description={
            info?.installed
              ? `版本 ${info.version ?? "未知"}${info.incompatible ? "（与兼容范围不符）" : ""}，位于 ${info.path ?? "系统 PATH"}`
              : "文档创建/编辑功能依赖的命令行工具，安装后可直接调用"
          }
          isDark={isDark}
        >
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full ${badge.cls}`}
            >
              {badge.text}
            </span>
            {!installed && (
              <button
                onClick={() => void handleInstall()}
                disabled={state === "running" || installing}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                  isDark
                    ? "bg-blue-600 hover:bg-blue-500 text-white"
                    : "bg-blue-500 hover:bg-blue-600 text-white"
                }`}
              >
                {state === "running" || installing ? "安装中…" : "一键安装"}
              </button>
            )}
          </div>
          {state === "failed" && status?.error && (
            <p
              className={`mt-2 text-xs ${isDark ? "text-red-400" : "text-red-600"}`}
            >
              安装失败：{status.error}
            </p>
          )}
          {status?.constraint && info?.incompatible && (
            <p
              className={`mt-2 text-xs ${isDark ? "text-amber-400" : "text-amber-600"}`}
            >
              文档生成经测试的版本范围：{status.constraint.minVersion} ~
              {status.constraint.maxVersion} （最近验证{" "}
              {status.constraint.lastTested}）
            </p>
          )}
        </ConfigItem>
      </ConfigSection>

      {/* 协作式文档生成 */}
      <ConfigSection
        title="协作式文档生成"
        description="分阶段流水线：大纲整理 → 内容填充+配图 → 成稿。关闭后改为一次性生成。"
        isDark={isDark}
      >
        <ConfigItem
          label="分阶段生成"
          description="启用后文档按「大纲→内容+配图→成稿」三阶段执行，每阶段可确认"
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={docWorkflow.staged}
            onChange={(v) => updateDocWorkflow("staged", v)}
          />
        </ConfigItem>
        <ConfigItem
          label="默认输出格式"
          description="未指定格式时的默认文档类型"
          isDark={isDark}
        >
          <SelectConfig
            isDark={isDark}
            value={docWorkflow.defaultFormat}
            onChange={(v) => updateDocWorkflow("defaultFormat", v)}
            options={[
              { value: "docx", label: "Word 文档" },
              { value: "pptx", label: "PPT 演示文稿" },
              { value: "html", label: "HTML 网页" },
              { value: "pdf", label: "PDF 文档" },
            ]}
          />
        </ConfigItem>
        <ConfigItem
          label="图片生成失败降级"
          description="开启后图片生成失败时保留占位符继续成稿，关闭则中止"
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={docWorkflow.degradeOnImageFailure}
            onChange={(v) => updateDocWorkflow("degradeOnImageFailure", v)}
          />
        </ConfigItem>
      </ConfigSection>

      {/* 协商式执行引擎 */}
      <ConfigSection
        title="协商式执行引擎"
        description="工具执行前的用户确认机制。关闭后所有操作自动执行不拦截。"
        isDark={isDark}
      >
        <ConfigItem
          label="启用协商式执行"
          description="开启后关键操作（外部动作、选型、异常结果）执行前需用户确认"
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={negotiation.enabled}
            onChange={(v) => updateNegotiation("enabled", v)}
          />
        </ConfigItem>
        <ConfigItem
          label="门控强度"
          description="strict=全拦截 | moderate=仅外部操作+异常 | relaxed=仅外部操作"
          isDark={isDark}
        >
          <SelectConfig
            isDark={isDark}
            value={negotiation.tier}
            onChange={(v) => updateNegotiation("tier", v)}
            disabled={!negotiation.enabled}
            options={[
              { value: "strict", label: "严格（全部拦截）" },
              { value: "moderate", label: "中等（外部操作+异常）" },
              { value: "relaxed", label: "宽松（仅外部操作）" },
            ]}
          />
        </ConfigItem>
        <ConfigItem
          label="超时自动降级"
          description="用户响应超时后是否自动取默认答案继续（关闭则中止操作）"
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={negotiation.autoDegradeOnTimeout}
            onChange={(v) => updateNegotiation("autoDegradeOnTimeout", v)}
            disabled={!negotiation.enabled}
          />
        </ConfigItem>
      </ConfigSection>
    </>
  );
}

export default OfficeProjectSettingsPanel;
