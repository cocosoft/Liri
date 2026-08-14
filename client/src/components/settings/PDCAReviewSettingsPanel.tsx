import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import { configService } from "../../services/configService";
import { handleClientError } from "../../utils/handleError";
import {
  ConfigSection,
  ConfigItem,
  ToggleConfig,
  SelectConfig,
  TextConfig,
} from "./ConfigComponents";

/** PDCA 审查门配置（与后端 ReviewGateConfig 对齐，经 config.json 的 pdca.review.gate 持久化） */
export interface PDCAReviewConfig {
  mode: "default" | "disabled" | "lenient" | "strict";
  /** 分数阈值（0-100），0 = 不启用分数门槛 */
  passThreshold: number;
  /** 机械验证开关（verifyProject） */
  enableMechanicalVerify: boolean;
  /** VerifierAgent 双指标验证开关 */
  enableVerifier: boolean;
}

const DEFAULT_CONFIG: PDCAReviewConfig = {
  mode: "default",
  passThreshold: 0,
  enableMechanicalVerify: true,
  enableVerifier: true,
};

const MODE_OPTIONS = [
  { value: "default", label: "默认（critical/major 阻塞）" },
  { value: "lenient", label: "宽松（仅 critical 阻塞，门槛 40）" },
  { value: "strict", label: "严格（含 minor 阻塞，门槛 80）" },
  { value: "disabled", label: "禁用（跳过审查直接批准）" },
];

function PDCAReviewSettingsPanel() {
  const { t } = useTranslation();
  const isDark = useConfigStore((s) => s.config.theme) === "dark";
  const [cfg, setCfg] = useState<PDCAReviewConfig>(DEFAULT_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    configService
      .get("pdca.review.gate")
      .then((v) => {
        if (v && typeof v === "object") {
          setCfg({ ...DEFAULT_CONFIG, ...(v as PDCAReviewConfig) });
        }
      })
      .catch((e) =>
        handleClientError(e, {
          module: "settings:PDCAReview",
          action: "load",
        }),
      )
      .finally(() => setLoaded(true));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await configService.set("pdca.review.gate", cfg);
      setSavedAt(Date.now());
    } catch (e) {
      handleClientError(e, {
        module: "settings:PDCAReview",
        action: "save",
      });
    } finally {
      setSaving(false);
    }
  };

  const disabled = cfg.mode === "disabled";

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <ConfigSection
        title={t("settings.pdcaReview")}
        description="PDCA 循环的 REVIEW + DECIDE 质量门配置。切换审查模式、分数门槛与验证开关，立即保存到后端配置（重启后仍生效）。"
        isDark={isDark}
      >
        {!loaded ? (
          <div className="py-4 text-sm text-gray-400 dark:text-gray-500">
            加载中...
          </div>
        ) : (
          <>
            <ConfigItem
              label="审查模式"
              description="默认：critical/major 阻塞；宽松：仅 critical；严格：含 minor；禁用：跳过审查直接批准"
              isDark={isDark}
            >
              <SelectConfig
                isDark={isDark}
                value={cfg.mode}
                onChange={(mode) =>
                  setCfg({ ...cfg, mode: mode as PDCAReviewConfig["mode"] })
                }
                options={MODE_OPTIONS}
              />
            </ConfigItem>

            <ConfigItem
              label="分数门槛（0-100）"
              description="低于该分数的审查不通过；0 = 不启用分数门槛"
              isDark={isDark}
            >
              <TextConfig
                isDark={isDark}
                type="number"
                value={String(cfg.passThreshold)}
                onChange={(v) =>
                  setCfg({
                    ...cfg,
                    passThreshold: Math.max(0, Math.min(100, Number(v) || 0)),
                  })
                }
                disabled={disabled}
                className="w-24"
              />
            </ConfigItem>

            <ConfigItem
              label="机械验证"
              description="执行前运行 verifyProject（编译/测试）作为 Reviewer 输入上下文"
              isDark={isDark}
            >
              <ToggleConfig
                isDark={isDark}
                checked={cfg.enableMechanicalVerify}
                onChange={(enableMechanicalVerify) =>
                  setCfg({ ...cfg, enableMechanicalVerify })
                }
                disabled={disabled}
              />
            </ConfigItem>

            <ConfigItem
              label="VerifierAgent 双指标验证"
              description="REJECT / ESCALATE 判定融合进审查结果"
              isDark={isDark}
            >
              <ToggleConfig
                isDark={isDark}
                checked={cfg.enableVerifier}
                onChange={(enableVerifier) =>
                  setCfg({ ...cfg, enableVerifier })
                }
                disabled={disabled}
              />
            </ConfigItem>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存"}
              </button>
              {savedAt && (
                <span className="text-xs text-green-500 dark:text-green-400">
                  已保存（{new Date(savedAt).toLocaleTimeString()}）
                </span>
              )}
            </div>
          </>
        )}
      </ConfigSection>
    </div>
  );
}

export default PDCAReviewSettingsPanel;
