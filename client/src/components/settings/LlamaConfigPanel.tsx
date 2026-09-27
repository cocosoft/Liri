/**
 * LlamaConfigPanel — llama.cpp 专业配置面板（设置模块）
 *
 * 面向专业人员暴露 llama-server 真实运行参数：
 * 服务（host/port/autoStart）、模型（GGUF 选择）、性能（GPU 层数/上下文）、
 * 以及「保存」与「应用并重启」动作。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ConfigSection,
  ConfigItem,
  SelectConfig,
  TextConfig,
  ToggleConfig,
} from "./ConfigComponents";
import {
  llamaService,
  type LlamaConfig,
  type LlamaStatus,
  type LlamaKvCacheTier,
  type LlamaHardwareInfo,
  type LlamaModelRecommendation,
  type MigrateProgress,
  type LlamaMigrateResponse,
  type LlamaDownloadedModelInfo,
  type ModelDownloadRequest,
} from "../../services/llamaService";
import { handleClientError } from "../../utils/handleError";

interface LlamaConfigPanelProps {
  isDark: boolean;
}

const STATUS_LABEL_KEY: Record<LlamaStatus["status"], string> = {
  stopped: "common.stopped",
  downloading: "settings.llamaStatusDownloading",
  starting: "settings.llamaStatusStarting",
  running: "common.running",
  error: "settings.llamaStatusError",
};

/** KV cache 档位选项（D1: low=q4_0 / medium=q8_0 / high=f16） */
const KV_CACHE_OPTIONS: { value: LlamaKvCacheTier; labelKey: string }[] = [
  { value: "low", labelKey: "settings.kvCacheLow" },
  { value: "medium", labelKey: "settings.kvCacheMedium" },
  { value: "high", labelKey: "settings.kvCacheHigh" },
];

/** Flash Attention 三态（D2 显式传默认值 auto） */
const FLASH_ATTN_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "auto", labelKey: "settings.flashAttnAuto" },
  { value: "on", labelKey: "settings.flashAttnOn" },
  { value: "off", labelKey: "settings.flashAttnOff" },
];

/** 数值输入解析：非数字回退默认值 */
function toNum(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
}

/** 判断推荐是否为最佳（与排序规则一致：适配度 → 质量分） */
function isBestRecommendation(
  target: LlamaModelRecommendation,
  list: LlamaModelRecommendation[],
): boolean {
  const sorted = [...list].sort((a, b) => {
    const suitOrder: Record<LlamaModelRecommendation["suitability"], number> = {
      high: 0,
      medium: 1,
      low: 2,
    };
    if (suitOrder[a.suitability] !== suitOrder[b.suitability]) {
      return suitOrder[a.suitability] - suitOrder[b.suitability];
    }
    return b.qualityScore - a.qualityScore;
  });
  return sorted[0]?.quantVersion === target.quantVersion;
}

function LlamaConfigPanel({ isDark }: LlamaConfigPanelProps) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<LlamaConfig | null>(null);
  const [status, setStatus] = useState<LlamaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // ─── 硬件检测 / 推荐 ──────────────────────────────────────────
  const [hardware, setHardware] = useState<LlamaHardwareInfo | null>(null);
  const [hardwareDetecting, setHardwareDetecting] = useState(false);
  const [recommendations, setRecommendations] = useState<
    LlamaModelRecommendation[]
  >([]);

  // ─── 迁移 ────────────────────────────────────────────────────
  const [migrating, setMigrating] = useState(false);
  const [migrateProgress, setMigrateProgress] =
    useState<MigrateProgress | null>(null);
  const [migrateResult, setMigrateResult] =
    useState<LlamaMigrateResponse | null>(null);
  const [migrateError, setMigrateError] = useState<string | null>(null);
  const [migrateShowConfirm, setMigrateShowConfirm] = useState(false);
  const [migrateCopy, setMigrateCopy] = useState(false);
  const [migrateOverwrite, setMigrateOverwrite] = useState(false);

  // ─── 下载 ────────────────────────────────────────────────────
  const [downloadingVersion, setDownloadingVersion] = useState<string | null>(
    null,
  );
  const [downloadProgress, setDownloadProgress] = useState<{
    percent?: number;
    status?: string;
  } | null>(null);
  const [downloadComplete, setDownloadComplete] =
    useState<LlamaDownloadedModelInfo | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // ─── 强制杀死/重启操作 ──────────────────────────────────────
  const [forceKilling, setForceKilling] = useState(false);
  const [forceRestarting, setForceRestarting] = useState(false);
  const [showForceKillConfirm, setShowForceKillConfirm] = useState(false);
  const [showForceRestartConfirm, setShowForceRestartConfirm] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logsContent, setLogsContent] = useState<string>("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [logStreamActive, setLogStreamActive] = useState(false);
  const logStreamControllerRef = useRef<AbortController | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  // ─── 模型删除确认 ──────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { config: cfg, status: st } = await llamaService.getConfig();
      setConfig(cfg);
      setStatus(st);
      setError(null);
    } catch (e) {
      handleClientError(e, { module: "settings:llama", action: "load" });
      setError(e instanceof Error ? e.message : t("settings.llamaLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // 硬件检测：页面加载时自动执行一次
  const runHardwareDetection = useCallback(
    async (force = false) => {
      setHardwareDetecting(true);
      setError(null);
      try {
        const hw = await llamaService.detectHardware(force);
        setHardware(hw);
        const recs = await llamaService.getRecommendations();
        setRecommendations(recs);
      } catch (e) {
        handleClientError(e, {
          module: "settings:llama",
          action: "detect_hardware",
        });
        setError(
          e instanceof Error
            ? e.message
            : t("settings.llamaHardwareDetectFailed"),
        );
      } finally {
        setHardwareDetecting(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void load();
    void runHardwareDetection();
    return () => {
      if (logStreamControllerRef.current) {
        logStreamControllerRef.current.abort();
        logStreamControllerRef.current = null;
      }
    };
  }, [load, runHardwareDetection]);

  const update = (patch: Partial<LlamaConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const handleSave = async (restart: boolean) => {
    if (!config) return;
    setSaving(true);
    setSavedMsg(null);
    setError(null);
    try {
      const saved = await llamaService.saveConfig(config);
      setConfig(saved);
      if (restart) {
        await llamaService.restart();
        setSavedMsg(t("settings.llamaSavedRestarted"));
      } else {
        setSavedMsg(t("settings.llamaSavedPendingRestart"));
      }
      await load(); // 刷新状态（含模型列表）
    } catch (e) {
      handleClientError(e, { module: "settings:llama", action: "save" });
      setError(e instanceof Error ? e.message : t("settings.llamaSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  // ─── 目录浏览 ────────────────────────────────────────────────
  const handleBrowseDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("settings.llamaSelectModelsDir"),
        defaultPath: config?.modelsDir || undefined,
      });
      if (selected && typeof selected === "string") {
        update({ modelsDir: selected });
      }
    } catch (e) {
      handleClientError(e, { module: "settings:llama", action: "browse_dir" });
      setError(
        e instanceof Error ? e.message : t("settings.llamaSelectDirFailed"),
      );
    }
  };

  // ─── 迁移 ────────────────────────────────────────────────────
  const handleStartMigration = async () => {
    if (!config?.modelsDir) return;
    setMigrateShowConfirm(false);
    setMigrating(true);
    setMigrateProgress(null);
    setMigrateResult(null);
    setMigrateError(null);

    try {
      await llamaService.startMigration(
        {
          targetDir: config.modelsDir,
          copy: migrateCopy,
          overwrite: migrateOverwrite,
        },
        {
          onProgress: (p) => setMigrateProgress(p),
          onComplete: (r) => setMigrateResult(r),
          onError: (e) => setMigrateError(e),
          onCancelled: () =>
            setMigrateError(t("settings.llamaMigrateCancelled")),
        },
      );
    } catch (e) {
      handleClientError(e, { module: "settings:llama", action: "migrate" });
      setMigrateError(
        e instanceof Error ? e.message : t("settings.llamaMigrateFailed"),
      );
    } finally {
      setMigrating(false);
      void load();
    }
  };

  const handleCancelMigration = async () => {
    try {
      await llamaService.cancelMigration();
    } catch (e) {
      handleClientError(e, {
        module: "settings:llama",
        action: "cancel_migrate",
      });
    }
  };

  // ─── 下载 ────────────────────────────────────────────────────
  const handleDownloadModel = async (rec: LlamaModelRecommendation) => {
    setDownloadingVersion(rec.quantVersion);
    setDownloadProgress({ percent: 0, status: t("settings.llamaDownloading") });
    setDownloadComplete(null);
    setDownloadError(null);

    const request: ModelDownloadRequest = {
      modelId: rec.modelId,
      quantVersion: rec.quantVersion,
      fileSizeGB: rec.fileSizeGB,
      qualityScore: rec.qualityScore,
      suitability: rec.suitability,
      estimatedRamGB: rec.estimatedRamGB,
      recommendationReason: rec.recommendationReason,
    };

    try {
      await llamaService.downloadModel(request, {
        autoStart: true,
        onProgress: (payload) => setDownloadProgress(payload),
        onComplete: (info) => setDownloadComplete(info),
        onError: (e) => setDownloadError(e),
      });
    } catch (e) {
      handleClientError(e, {
        module: "settings:llama",
        action: "download_model",
      });
      setDownloadError(
        e instanceof Error ? e.message : t("settings.llamaDownloadFailed"),
      );
    } finally {
      setDownloadingVersion(null);
      void load();
    }
  };

  // ─── 删除 ────────────────────────────────────────────────────
  const handleDeleteModel = async () => {
    if (!deleteConfirm) return;
    const filename = deleteConfirm;
    setDeleteConfirm(null);
    try {
      await llamaService.deleteModel(filename);
      setSavedMsg(t("settings.llamaModelDeleted", { name: filename }));
      void load();
    } catch (e) {
      handleClientError(e, {
        module: "settings:llama",
        action: "delete_model",
      });
      setError(
        e instanceof Error ? e.message : t("settings.llamaDeleteFailed"),
      );
    }
  };

  // ─── 强制杀死/重启 ────────────────────────────────────────────
  const handleForceKill = async () => {
    setShowForceKillConfirm(false);
    setForceKilling(true);
    setError(null);
    setSavedMsg(null);
    try {
      const result = await llamaService.forceKill();
      setSavedMsg(result.message);
      await load();
    } catch (e) {
      handleClientError(e, { module: "settings:llama", action: "forceKill" });
      setError(
        e instanceof Error ? e.message : t("settings.llamaForceKillFailed"),
      );
    } finally {
      setForceKilling(false);
    }
  };

  const handleForceRestart = async () => {
    setShowForceRestartConfirm(false);
    setForceRestarting(true);
    setError(null);
    setSavedMsg(null);
    try {
      const result = await llamaService.forceRestart();
      if (result.success) {
        setSavedMsg(t("settings.llamaForceRestarted"));
      } else {
        setError(t("settings.llamaForceRestartNotReady"));
      }
      await load();
    } catch (e) {
      handleClientError(e, {
        module: "settings:llama",
        action: "forceRestart",
      });
      setError(
        e instanceof Error ? e.message : t("settings.llamaForceRestartFailed"),
      );
    } finally {
      setForceRestarting(false);
    }
  };

  const handleViewLogs = async () => {
    setShowLogs(true);
    setLogsLoading(true);
    try {
      const logs = await llamaService.getLogs(500);
      setLogsContent(logs);
    } catch (e) {
      handleClientError(e, { module: "settings:llama", action: "getLogs" });
      setLogsContent(
        t("settings.llamaGetLogsFailed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setLogsLoading(false);
    }
  };

  // ─── 实时日志流 ──────────────────────────────────────────────
  const handleStartLogStream = async () => {
    if (logStreamControllerRef.current) {
      logStreamControllerRef.current.abort();
      logStreamControllerRef.current = null;
    }
    setShowLogs(true);
    setLogsContent("");
    setLogStreamActive(true);

    try {
      const controller = await llamaService.subscribeLogsStream(
        {
          onInitial: (logs) => {
            setLogsContent(logs);
            logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
          },
          onLog: (logs) => {
            setLogsContent((prev) => prev + logs);
            logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
          },
          onError: (err) => {
            setLogsContent(
              (prev) =>
                prev + t("settings.llamaLogStreamError", { error: err }),
            );
            setLogStreamActive(false);
          },
        },
        200,
      );
      logStreamControllerRef.current = controller;
    } catch (e) {
      handleClientError(e, {
        module: "settings:llama",
        action: "subscribeLogs",
      });
      setLogStreamActive(false);
    }
  };

  const handleStopLogStream = () => {
    if (logStreamControllerRef.current) {
      logStreamControllerRef.current.abort();
      logStreamControllerRef.current = null;
    }
    setLogStreamActive(false);
  };

  if (loading) {
    return (
      <div className={`p-6 ${isDark ? "text-gray-400" : "text-gray-500"}`}>
        {t("common.loadingEllipsis")}
      </div>
    );
  }

  const modelOptions = (status?.models ?? []).map((p) => ({
    value: p,
    label: p.split(/[\\/]/).pop() || p,
  }));

  return (
    <div className="p-6">
      <ConfigSection
        title={t("settings.llama")}
        description={t("settings.llamaDesc")}
        isDark={isDark}
      >
        {/* 服务状态 */}
        <ConfigItem label={t("settings.serviceStatus")} isDark={isDark}>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                status?.running
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : status?.status === "error"
                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
              }`}
            >
              {status
                ? t(STATUS_LABEL_KEY[status.status])
                : t("common.unknown")}
            </span>
            {status && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {t("settings.llamaStatusLine", {
                  version: status.version,
                  port: status.port,
                  count: status.restartCount,
                })}
                {status.binaryExists ? "" : t("settings.llamaBinaryMissing")}
              </span>
            )}
          </div>
        </ConfigItem>
        {status?.lastError && (
          <ConfigItem label={t("settings.lastError")} isDark={isDark}>
            <span className="text-xs text-red-500">{status.lastError}</span>
          </ConfigItem>
        )}

        {/* 紧急操作 */}
        <ConfigItem label={t("settings.emergencyOps")} isDark={isDark}>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowForceKillConfirm(true)}
              disabled={forceKilling || forceRestarting}
              className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title={t("settings.llamaForceKillTitle")}
            >
              {forceKilling
                ? t("settings.llamaKilling")
                : t("settings.llamaForceKill")}
            </button>
            <button
              onClick={() => setShowForceRestartConfirm(true)}
              disabled={forceKilling || forceRestarting}
              className="px-3 py-1.5 text-xs bg-orange-600 hover:bg-orange-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title={t("settings.llamaForceRestartTitle")}
            >
              {forceRestarting
                ? t("settings.llamaRestarting")
                : t("settings.llamaForceRestart")}
            </button>
            <button
              onClick={() => void handleViewLogs()}
              disabled={logsLoading}
              className="px-3 py-1.5 text-xs bg-gray-500 hover:bg-gray-400 text-white rounded disabled:opacity-50"
              title={t("settings.llamaViewLogsTitle")}
            >
              {t("settings.llamaViewLogs")}
            </button>
          </div>
        </ConfigItem>

        {/* 服务配置 */}
        <ConfigItem label={t("settings.listenAddress")} isDark={isDark}>
          <TextConfig
            isDark={isDark}
            value={config?.host ?? "127.0.0.1"}
            onChange={(v) => update({ host: v })}
            placeholder="127.0.0.1"
            className="w-48"
          />
        </ConfigItem>
        <ConfigItem
          label={t("settings.portLabel")}
          description={t("settings.llamaPortDesc")}
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(config?.port ?? 11435)}
            onChange={(v) => update({ port: parseInt(v, 10) || 11435 })}
            className="w-24"
          />
        </ConfigItem>
        <ConfigItem label={t("settings.llamaAutoStart")} isDark={isDark}>
          <ToggleConfig
            isDark={isDark}
            checked={config?.autoStart ?? true}
            onChange={(v) => update({ autoStart: v })}
          />
        </ConfigItem>

        {/* 模型配置 */}
        <ConfigItem
          label={t("settings.llamaGgufModel")}
          description={t("settings.llamaScanLocalModels")}
          isDark={isDark}
        >
          <SelectConfig
            isDark={isDark}
            value={config?.model ?? ""}
            onChange={(v) => update({ model: v })}
            options={[
              { value: "", label: t("settings.llamaNotSet") },
              ...modelOptions,
            ]}
          />
        </ConfigItem>
        {config?.model && (
          <ConfigItem
            label={t("settings.llamaCurrentModelPath")}
            isDark={isDark}
          >
            <span className="text-xs text-gray-500 dark:text-gray-400 break-all">
              {config.model}
            </span>
          </ConfigItem>
        )}

        {/* 性能配置 */}
        <ConfigItem
          label={t("settings.llamaGpuLayers")}
          description={t("settings.llamaGpuLayersDesc")}
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(config?.gpuLayers ?? 0)}
            onChange={(v) =>
              update({ gpuLayers: Math.max(0, parseInt(v, 10) || 0) })
            }
            className="w-24"
          />
        </ConfigItem>
        <ConfigItem
          label={t("settings.llamaContextWindow")}
          description={t("settings.llamaContextWindowDesc")}
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(config?.contextWindow ?? 4096)}
            onChange={(v) =>
              update({ contextWindow: Math.max(512, parseInt(v, 10) || 4096) })
            }
            className="w-28"
          />
        </ConfigItem>
        <ConfigItem
          label={t("settings.llamaKvCache")}
          description={t("settings.llamaKvCacheDesc")}
          isDark={isDark}
        >
          <SelectConfig
            isDark={isDark}
            value={config?.kvCache ?? "high"}
            onChange={(v) => update({ kvCache: v as LlamaKvCacheTier })}
            options={KV_CACHE_OPTIONS.map((o) => ({
              value: o.value,
              label: t(o.labelKey),
            }))}
            className="w-32"
          />
        </ConfigItem>
        <ConfigItem
          label={t("settings.llamaThreads")}
          description={t("settings.llamaThreadsDesc")}
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(config?.threads ?? 0)}
            onChange={(v) =>
              update({ threads: Math.max(0, Math.round(toNum(v, 0))) })
            }
            className="w-24"
          />
        </ConfigItem>
        <ConfigItem
          label={t("settings.llamaBatchSize")}
          description={t("settings.llamaBatchSizeDesc")}
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(config?.batchSize ?? 0)}
            onChange={(v) =>
              update({ batchSize: Math.max(0, Math.round(toNum(v, 0))) })
            }
            className="w-24"
          />
        </ConfigItem>

        {/* 采样配置（D2：显式传默认值，与 llama.cpp 默认一致） */}
        <ConfigItem
          label={t("settings.llamaTemperature")}
          description={t("settings.llamaDefault08")}
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(config?.temperature ?? 0.8)}
            onChange={(v) => update({ temperature: toNum(v, 0.8) })}
            className="w-24"
          />
        </ConfigItem>
        <ConfigItem
          label="Top-K (--top-k)"
          description={t("settings.llamaDefault40")}
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(config?.topK ?? 40)}
            onChange={(v) =>
              update({ topK: Math.max(1, Math.round(toNum(v, 40))) })
            }
            className="w-24"
          />
        </ConfigItem>
        <ConfigItem
          label="Top-P (--top-p)"
          description={t("settings.llamaDefault095")}
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(config?.topP ?? 0.95)}
            onChange={(v) => update({ topP: toNum(v, 0.95) })}
            className="w-24"
          />
        </ConfigItem>
        <ConfigItem
          label={t("settings.llamaRepeatPenalty")}
          description={t("settings.llamaDefault11")}
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(config?.repeatPenalty ?? 1.1)}
            onChange={(v) => update({ repeatPenalty: toNum(v, 1.1) })}
            className="w-24"
          />
        </ConfigItem>
        <ConfigItem
          label={t("settings.llamaSeed")}
          description={t("settings.llamaSeedDesc")}
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(config?.seed ?? -1)}
            onChange={(v) => update({ seed: Math.round(toNum(v, -1)) })}
            className="w-24"
          />
        </ConfigItem>

        {/* 高级配置 */}
        <ConfigItem
          label="--no-mmap"
          description={t("settings.llamaNoMmapDesc")}
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={config?.noMmap ?? false}
            onChange={(v) => update({ noMmap: v })}
          />
        </ConfigItem>
        <ConfigItem
          label="--mlock"
          description={t("settings.llamaMlockDesc")}
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={config?.mlock ?? false}
            onChange={(v) => update({ mlock: v })}
          />
        </ConfigItem>
        <ConfigItem
          label="Flash Attention (--flash-attn)"
          description={t("settings.llamaFlashAttnDesc")}
          isDark={isDark}
        >
          <SelectConfig
            isDark={isDark}
            value={config?.flashAttn ?? "auto"}
            onChange={(v) =>
              update({ flashAttn: v as LlamaConfig["flashAttn"] })
            }
            options={FLASH_ATTN_OPTIONS.map((o) => ({
              value: o.value,
              label: t(o.labelKey),
            }))}
            className="w-32"
          />
        </ConfigItem>

        {error && (
          <ConfigItem label="" isDark={isDark}>
            <span className="text-xs text-red-500">{error}</span>
          </ConfigItem>
        )}
        {savedMsg && (
          <ConfigItem label="" isDark={isDark}>
            <span className="text-xs text-green-600 dark:text-green-400">
              {savedMsg}
            </span>
          </ConfigItem>
        )}

        <div className="flex gap-2 mt-4">
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              saving
                ? "opacity-50 cursor-not-allowed bg-gray-500 text-white"
                : "bg-blue-600 hover:bg-blue-500 text-white"
            }`}
          >
            {saving ? t("settings.llamaSaving") : t("settings.llamaSave")}
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              saving
                ? "opacity-50 cursor-not-allowed bg-gray-500 text-white"
                : "bg-indigo-600 hover:bg-indigo-500 text-white"
            }`}
          >
            {saving
              ? t("settings.llamaRestarting")
              : t("settings.llamaSaveAndRestart")}
          </button>
        </div>
      </ConfigSection>

      {/* ─── 系统检测 / 智能推荐（小白友好） ──────────── */}
      <ConfigSection
        title={t("settings.llamaSystemDetect")}
        description={t("settings.llamaSystemDetectDesc")}
        isDark={isDark}
      >
        {hardwareDetecting && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {t("settings.llamaDetectingHardware")}
          </div>
        )}
        {hardware && !hardwareDetecting && (
          <>
            <ConfigItem label={t("settings.llamaCpuCores")} isDark={isDark}>
              <span className="text-sm">
                {t("settings.llamaCpuCoresValue", {
                  cores: hardware.cpuCores,
                  memory: hardware.systemMemoryGB,
                })}
              </span>
            </ConfigItem>
            <ConfigItem label="GPU" isDark={isDark}>
              <span className="text-sm">
                {hardware.gpu.name
                  ? t("settings.llamaGpuMemory", {
                      name: hardware.gpu.name,
                      memory: hardware.gpu.memoryGB,
                    })
                  : t("settings.llamaNoDiscreteGpu")}
              </span>
            </ConfigItem>
            <ConfigItem
              label={t("settings.llamaRecommendedBackend")}
              isDark={isDark}
            >
              <span
                className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                  hardware.llamaCppBackend === "cpu"
                    ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                    : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                }`}
              >
                {hardware.llamaCppBackend === "cpu"
                  ? t("settings.llamaCpuInference")
                  : t("settings.llamaGpuAccelerated", {
                      backend: hardware.llamaCppBackend,
                    })}
              </span>
            </ConfigItem>
          </>
        )}
        <button
          onClick={() => void runHardwareDetection(true)}
          disabled={hardwareDetecting}
          className="text-xs text-blue-500 hover:text-blue-600 disabled:opacity-50"
        >
          {t("settings.llamaRedetect")}
        </button>
      </ConfigSection>

      {recommendations.length > 0 && (
        <ConfigSection
          title={t("settings.llamaRecommendedForYou")}
          description={t("settings.llamaRecommendedDesc")}
          isDark={isDark}
        >
          <div className="space-y-3">
            {recommendations.map((rec) => {
              const isBest = isBestRecommendation(rec, recommendations);
              const suitClass =
                rec.suitability === "high"
                  ? "border-green-500 bg-green-50 dark:bg-green-900/20"
                  : rec.suitability === "medium"
                    ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20"
                    : "border-gray-300 opacity-70";
              return (
                <div
                  key={rec.quantVersion}
                  className={`p-3 rounded-lg border-2 ${suitClass}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{rec.displayName}</span>
                        <span className="text-xs text-gray-500">
                          {rec.quantVersion}
                        </span>
                        {isBest && (
                          <span className="px-1.5 py-0.5 text-xs rounded bg-green-500 text-white">
                            {t("settings.llamaBestPick")}
                          </span>
                        )}
                        {rec.suitability === "high" && !isBest && (
                          <span className="px-1.5 py-0.5 text-xs rounded bg-green-100 text-green-700">
                            {t("settings.llamaSuitable")}
                          </span>
                        )}
                        {rec.suitability === "medium" && (
                          <span className="px-1.5 py-0.5 text-xs rounded bg-yellow-100 text-yellow-700">
                            {t("settings.llamaUsable")}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {t("settings.llamaRecMeta", {
                          size: rec.fileSizeGB,
                          ram: rec.estimatedRamGB,
                          quality: rec.qualityScore,
                        })}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {t("settings.llamaRecReason", {
                          reason: rec.recommendationReason,
                        })}
                      </div>
                    </div>
                    <button
                      onClick={() => void handleDownloadModel(rec)}
                      disabled={downloadingVersion === rec.quantVersion}
                      className="shrink-0 px-3 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                    >
                      {downloadingVersion === rec.quantVersion
                        ? t("settings.llamaStatusDownloading")
                        : t("settings.llamaDownloadThis")}
                    </button>
                  </div>

                  {downloadingVersion === rec.quantVersion &&
                    downloadProgress && (
                      <div className="mt-2">
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>
                            {downloadProgress.status ??
                              t("settings.llamaDownloading")}
                          </span>
                          <span>{downloadProgress.percent ?? 0}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 transition-all duration-200"
                            style={{
                              width: `${downloadProgress.percent ?? 0}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                </div>
              );
            })}
          </div>
          {downloadComplete && (
            <div className="mt-3 p-2 bg-green-50 dark:bg-green-900/20 rounded text-xs text-green-700 dark:text-green-300">
              {t("settings.llamaDownloadComplete", {
                version: downloadComplete.quantVersion,
              })}
              {downloadComplete.autoStart
                ? t("settings.llamaServiceStarted")
                : ""}
            </div>
          )}
          {downloadError && (
            <div className="mt-3 p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs text-red-600 dark:text-red-300">
              {t("settings.llamaDownloadFailedInline", {
                error: downloadError,
              })}
            </div>
          )}
        </ConfigSection>
      )}

      {/* ─── 模型存储与迁移 ──────────────────────────────── */}
      <ConfigSection
        title={t("settings.llamaModelStorage")}
        description={t("settings.llamaModelStorageDesc")}
        isDark={isDark}
      >
        <ConfigItem
          label={t("settings.llamaModelsDir")}
          description={t("settings.llamaModelsDirDesc")}
          isDark={isDark}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <TextConfig
              isDark={isDark}
              value={config?.modelsDir ?? ""}
              onChange={(v) => update({ modelsDir: v })}
              placeholder={status?.modelsDir || t("settings.defaultPath")}
              className="min-w-[320px] max-w-full flex-1"
            />
            <button
              onClick={() => void handleBrowseDir()}
              className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              {t("settings.llamaBrowse")}
            </button>
            {config?.modelsDir && (
              <button
                onClick={() => update({ modelsDir: "" })}
                className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                title={t("settings.llamaRestoreDefaultPath")}
              >
                {t("common.reset")}
              </button>
            )}
          </div>
        </ConfigItem>

        {status?.modelsDir && (
          <ConfigItem label={t("settings.llamaCurrentDir")} isDark={isDark}>
            <div className="text-xs text-gray-500 dark:text-gray-400 break-all">
              <div>
                {t("settings.llamaPathLine", { path: status.modelsDir })}
              </div>
              <div>
                {t("settings.llamaModelCountLine", {
                  count: status.models.length,
                })}
              </div>
            </div>
          </ConfigItem>
        )}

        {/* 迁移入口 */}
        {config?.modelsDir &&
          status?.modelsDir &&
          config.modelsDir !== status.modelsDir && (
            <ConfigItem
              label={t("settings.llamaMigrate")}
              description={t("settings.llamaMigrateDesc")}
              isDark={isDark}
            >
              <div className="space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={() => setMigrateShowConfirm(true)}
                    disabled={migrating}
                    className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                  >
                    {migrating
                      ? t("settings.llamaMigratingShort")
                      : t("settings.llamaMigrateToNewDir")}
                  </button>
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={migrateCopy}
                      onChange={(e) => setMigrateCopy(e.target.checked)}
                    />
                    {t("settings.llamaCopyNotMove")}
                  </label>
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={migrateOverwrite}
                      onChange={(e) => setMigrateOverwrite(e.target.checked)}
                    />
                    {t("settings.llamaOverwrite")}
                  </label>
                </div>

                {migrating && migrateProgress && (
                  <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded">
                    <div className="flex justify-between text-xs mb-1">
                      <span>
                        {t("settings.llamaMigrating", {
                          file: migrateProgress.file,
                          current: migrateProgress.current,
                          total: migrateProgress.total,
                        })}
                      </span>
                      <span>{migrateProgress.percent}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all duration-200"
                        style={{ width: `${migrateProgress.percent}%` }}
                      />
                    </div>
                    <button
                      onClick={() => void handleCancelMigration()}
                      className="mt-1 text-xs text-red-500 hover:text-red-600"
                    >
                      {t("settings.llamaCancelMigrate")}
                    </button>
                  </div>
                )}

                {!migrating && migrateResult && (
                  <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs">
                    <div className="font-medium">
                      {t("settings.llamaMigrateDone", {
                        ms: migrateResult.elapsedMs,
                      })}
                    </div>
                    <div>
                      {t("settings.llamaMigratedCount", {
                        count: migrateResult.migratedFiles.length,
                      })}
                    </div>
                    {migrateResult.skippedFiles.length > 0 && (
                      <div className="text-yellow-600">
                        {t("settings.llamaSkippedCount", {
                          count: migrateResult.skippedFiles.length,
                        })}
                      </div>
                    )}
                    {migrateResult.failedFiles.length > 0 && (
                      <div className="text-red-600">
                        {t("settings.llamaFailedCount", {
                          count: migrateResult.failedFiles.length,
                        })}
                      </div>
                    )}
                  </div>
                )}

                {!migrating && migrateError && (
                  <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs text-red-600 dark:text-red-300">
                    ❌ {migrateError}
                  </div>
                )}
              </div>
            </ConfigItem>
          )}

        {/* 二次确认对话框 */}
        {migrateShowConfirm && config?.modelsDir && status?.modelsDir && (
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs">
            <div className="font-medium mb-1">
              {t("settings.llamaConfirmMigrateTitle")}
            </div>
            <p>
              {t(
                migrateCopy
                  ? "settings.llamaConfirmCopyPrefix"
                  : "settings.llamaConfirmMovePrefix",
              )}
              <b>{status.models.length}</b>
              {t("settings.llamaConfirmSuffix")}
            </p>
            <p className="font-mono mt-1 break-all">{config.modelsDir}</p>
            {!migrateCopy && (
              <p className="text-red-500 mt-1">
                {t("settings.llamaMoveWarning")}
              </p>
            )}
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => void handleStartMigration()}
                className="px-3 py-1 bg-blue-500 text-white rounded"
              >
                {t("settings.llamaConfirmMigrate")}
              </button>
              <button
                onClick={() => setMigrateShowConfirm(false)}
                className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        )}
      </ConfigSection>

      {/* ─── 模型管理（删除） ────────────────────────────── */}
      {status && status.models.length > 0 && (
        <ConfigSection
          title={t("settings.llamaModelManagement")}
          description={t("settings.llamaModelManagementDesc")}
          isDark={isDark}
        >
          <div className="space-y-1">
            {status.models.map((modelPath) => {
              const fileName = modelPath.split(/[\\/]/).pop() || modelPath;
              const isInUse = config?.model === modelPath;
              return (
                <div
                  key={modelPath}
                  className="flex items-center justify-between gap-2 py-1 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <span className="text-xs font-mono truncate flex-1">
                    {fileName}
                    {isInUse && (
                      <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                        {t("settings.llamaInUse")}
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => setDeleteConfirm(fileName)}
                    disabled={isInUse}
                    className="text-xs text-red-500 hover:text-red-600 disabled:opacity-30"
                  >
                    {t("common.delete")}
                  </button>
                </div>
              );
            })}
          </div>

          {deleteConfirm && (
            <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs">
              <div className="mb-1">
                {t("settings.llamaConfirmDeletePrefix")}
                <b>{deleteConfirm}</b>
                {t("settings.llamaConfirmDeleteSuffix")}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => void handleDeleteModel()}
                  className="px-3 py-1 bg-red-500 text-white rounded"
                >
                  {t("settings.llamaConfirmDelete")}
                </button>
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}
        </ConfigSection>
      )}

      {/* ─── 紧急操作确认对话框 ──────────────────────────────────── */}
      {showForceKillConfirm && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-xs">
          <div className="font-medium text-red-600 mb-1">
            {t("settings.warningLabel")}
          </div>
          <div className="mb-2">
            {t("settings.llamaForceKillWarnPrefix")}
            <strong>{t("settings.llamaForceKillWarnStrong")}</strong>
            {t("settings.llamaForceKillWarnSuffix")}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void handleForceKill()}
              disabled={forceKilling}
              className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded disabled:opacity-50"
            >
              {forceKilling
                ? t("settings.llamaKilling")
                : t("settings.llamaConfirmForceKill")}
            </button>
            <button
              onClick={() => setShowForceKillConfirm(false)}
              disabled={forceKilling}
              className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {showForceRestartConfirm && (
        <div className="p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded text-xs">
          <div className="font-medium text-orange-600 mb-1">
            {t("settings.warningLabel")}
          </div>
          <div className="mb-2">
            {t("settings.llamaForceRestartWarnPrefix")}
            <strong>{t("settings.llamaForceRestartWarnStrong")}</strong>
            {t("settings.llamaForceRestartWarnSuffix")}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void handleForceRestart()}
              disabled={forceRestarting}
              className="px-3 py-1 bg-orange-600 hover:bg-orange-500 text-white rounded disabled:opacity-50"
            >
              {forceRestarting
                ? t("settings.llamaRestarting")
                : t("settings.llamaConfirmForceRestart")}
            </button>
            <button
              onClick={() => setShowForceRestartConfirm(false)}
              disabled={forceRestarting}
              className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* ─── 日志查看面板 ──────────────────────────────────────── */}
      {showLogs && (
        <ConfigSection
          title={`${t("settings.llamaServerLogs")}${logStreamActive ? t("settings.llamaLiveFollowing") : ""}`}
          description={t("settings.llamaLogsDesc")}
          isDark={isDark}
        >
          <div className="flex items-center gap-2 mb-2">
            {logStreamActive ? (
              <button
                onClick={handleStopLogStream}
                className="text-xs text-red-500 hover:text-red-600"
              >
                {t("settings.llamaStopFollowing")}
              </button>
            ) : (
              <button
                onClick={() => void handleStartLogStream()}
                className="text-xs text-green-500 hover:text-green-600"
              >
                {t("settings.llamaStartFollowing")}
              </button>
            )}
            <button
              onClick={() => void handleViewLogs()}
              disabled={logsLoading || logStreamActive}
              className="text-xs text-blue-500 hover:text-blue-600 disabled:opacity-50"
            >
              {logsLoading
                ? t("common.loadingEllipsis")
                : t("settings.llamaRefreshLogs")}
            </button>
            <button
              onClick={() => {
                handleStopLogStream();
                setShowLogs(false);
              }}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              {t("settings.llamaCloseLogs")}
            </button>
          </div>
          <div className="bg-gray-900 dark:bg-black rounded p-2 max-h-96 overflow-auto">
            <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap break-all">
              {logsContent || t("settings.llamaNoLogs")}
            </pre>
            <div ref={logsEndRef} />
          </div>
          {logStreamActive && (
            <div className="mt-1 text-xs text-green-600 animate-pulse">
              {t("settings.llamaFollowingHint")}
            </div>
          )}
        </ConfigSection>
      )}
    </div>
  );
}

export default LlamaConfigPanel;
