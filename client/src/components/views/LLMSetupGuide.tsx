import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { modelService } from "../../services/modelService";
import { providerService } from "../../services/providerService";
import type { ProviderInfo, ProviderPreset } from "../../types";

interface LLMSetupGuideProps {
  onDismiss: () => void;
}

type Step = "provider" | "key" | "done";

type ImportedModel = Awaited<ReturnType<typeof providerService.createModel>>;

const STEPS: Array<{
  key: "stepProvider" | "stepKey" | "stepDone";
  step: Step;
}> = [
  { key: "stepProvider", step: "provider" },
  { key: "stepKey", step: "key" },
  { key: "stepDone", step: "done" },
];

export function LLMSetupGuide({ onDismiss }: LLMSetupGuideProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // 已有模型则自动关闭引导
  const [checking, setChecking] = useState(true);
  const [hasModels, setHasModels] = useState(false);

  const [step, setStep] = useState<Step>("provider");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ProviderInfo | null>(null);
  const [keyUrl, setKeyUrl] = useState("");

  const [apiKey, setApiKey] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportedModel | null>(null);

  const [testing, setTesting] = useState(true);
  const [testOk, setTestOk] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const models = await modelService.list();
        if (!cancelled) setHasModels(models.length > 0);
      } catch {
        if (!cancelled) setHasModels(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    };
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!checking && hasModels) {
      onDismiss();
    }
  }, [checking, hasModels, onDismiss]);

  // 加载服务商列表；为空时加载官方预设（真实后端数据）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await providerService.list();
        if (cancelled) return;
        if (list.length > 0) {
          setProviders(list);
        } else {
          const presetsObj = await providerService.getPresets();
          if (cancelled) return;
          setPresets(
            Object.values(presetsObj).flat() as unknown as ProviderPreset[],
          );
        }
      } catch {
        if (!cancelled) setProviders([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 进入完成步后自动测试连通
  useEffect(() => {
    if (step !== "done" || !imported || !selected) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await modelService.test(imported.modelId, selected.id);
        if (!cancelled) setTestOk(res.success === true);
      } catch {
        if (!cancelled) setTestOk(false);
      } finally {
        if (!cancelled) setTesting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, imported, selected]);

  const handleSelectProvider = async (p: ProviderInfo | ProviderPreset) => {
    if ("settingsConfig" in p) {
      // 预设 → 创建真实服务商
      setVerifying(true);
      setKeyError(null);
      try {
        const created = await providerService.create(p.settingsConfig);
        setSelected(created);
        setKeyUrl(p.apiKeyUrl || p.websiteUrl || p.settingsConfig.baseUrl);
        setStep("key");
      } catch {
        setKeyError(t("onboarding.keyInvalid"));
      } finally {
        setVerifying(false);
      }
    } else {
      setSelected(p);
      setKeyUrl(p.baseUrl);
      setStep("key");
    }
  };

  const handleVerifyKey = async () => {
    if (!selected) return;
    setVerifying(true);
    setKeyError(null);
    try {
      let provider = selected;
      if (selected.requiresAuth && apiKey.trim()) {
        provider = await providerService.update(selected.id, {
          apiKey: apiKey.trim(),
        });
      }
      const result = await providerService.fetchModels(provider.id, {
        pageSize: 50,
      });
      if ("error" in result) {
        setKeyError(t("onboarding.keyInvalid"));
        return;
      }
      const models = result.models || [];
      if (models.length === 0) {
        setKeyError(t("onboarding.keyInvalid"));
        return;
      }
      const created = await providerService.createModel({
        modelId: models[0].id,
        providerId: provider.id,
      });
      setImported(created);
      setStep("done");
    } catch {
      setKeyError(t("onboarding.keyInvalid"));
    } finally {
      setVerifying(false);
    }
  };

  const handleStartChat = () => {
    onDismiss();
    navigate("/");
  };

  const handleAdvanced = () => {
    navigate("/models");
    onDismiss();
  };

  if (checking) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-50/90 dark:bg-gray-900/90">
        <div className="text-gray-400 text-sm">{t("common.loading")}</div>
      </div>
    );
  }

  if (hasModels) return null;

  const stepIndex = STEPS.findIndex((s) => s.step === step);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-50/90 dark:bg-gray-900/90 overflow-y-auto">
      <div className="max-w-md w-full mx-4 my-8 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8">
        {/* 标题 + 步骤指示器 */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <svg
              className="w-7 h-7 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {t("onboarding.title")}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t("onboarding.subtitle")}
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 mb-6">
          {STEPS.map((s, i) => (
            <div key={s.step} className="flex items-center gap-2">
              <div
                className={`flex items-center gap-1.5 text-xs ${
                  i <= stepIndex
                    ? "text-blue-600 dark:text-blue-400 font-medium"
                    : "text-gray-400 dark:text-gray-500"
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                    i < stepIndex
                      ? "bg-blue-600 text-white"
                      : i === stepIndex
                        ? "border-2 border-blue-500 text-blue-600 dark:text-blue-400"
                        : "border border-gray-300 dark:border-gray-600 text-gray-400"
                  }`}
                >
                  {i + 1}
                </span>
                {t(`onboarding.${s.key}`)}
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`w-6 h-px ${
                    i < stepIndex
                      ? "bg-blue-500"
                      : "bg-gray-300 dark:bg-gray-600"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {step === "provider" && (
          <div>
            <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-4 text-center">
              {t("onboarding.chooseProvider")}
            </h3>
            {loading ? (
              <div className="text-center text-sm text-gray-400 py-6">
                {t("common.loading")}
              </div>
            ) : (
              <div className="space-y-2.5">
                {providers.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectProvider(p)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-left transition-colors"
                  >
                    <span
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ backgroundColor: p.iconColor || "#64748b" }}
                    >
                      {p.icon || p.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {p.name}
                      </span>
                      <span className="block text-xs text-gray-400 dark:text-gray-500 truncate">
                        {p.baseUrl}
                      </span>
                    </span>
                  </button>
                ))}
                {providers.length === 0 && presets.length === 0 && (
                  <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-4">
                    {t("onboarding.noProvider")}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {step === "key" && selected && (
          <div>
            <div className="flex items-center gap-3 mb-5">
              <span
                className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{ backgroundColor: selected.iconColor || "#64748b" }}
              >
                {selected.icon || selected.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {selected.name}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                  {selected.baseUrl}
                </p>
              </div>
            </div>

            {selected.requiresAuth ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {t("onboarding.pasteKey")}
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t("onboarding.pasteKeyPlaceholder")}
                  autoComplete="off"
                  className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {keyUrl && (
                  <a
                    href={keyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {t("onboarding.openWebsite")}
                  </a>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                {t("onboarding.localNote")}
              </p>
            )}

            {keyError && (
              <div className="mt-3 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                {keyError}
              </div>
            )}

            <div className="flex items-center gap-3 mt-5">
              <button
                onClick={() => setStep("provider")}
                className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg transition-colors"
              >
                {t("onboarding.changeProvider")}
              </button>
              <button
                onClick={handleVerifyKey}
                disabled={
                  verifying || (selected.requiresAuth && !apiKey.trim())
                }
                className="flex-1 px-4 py-2.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
              >
                {verifying
                  ? t("onboarding.verifying")
                  : t("onboarding.verifyKey")}
              </button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-green-600 dark:text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">
              {t("onboarding.allSet")}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {t("onboarding.allSetDesc")}
            </p>
            {imported && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-5">
                {testing
                  ? t("common.loading")
                  : testOk
                    ? t("onboarding.keyValid")
                    : t("onboarding.keyInvalid")}
              </p>
            )}
            <button
              onClick={handleStartChat}
              className="w-full px-4 py-3 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
            >
              {t("onboarding.startChat")}
            </button>
            <button
              onClick={() => setStep("provider")}
              className="mt-3 w-full px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              {t("onboarding.changeProvider")}
            </button>
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <button
            onClick={onDismiss}
            className="text-xs text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
          >
            {t("onboarding.skip")}
          </button>
          <button
            onClick={handleAdvanced}
            className="text-xs text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
          >
            {t("onboarding.advancedSetup")}
          </button>
        </div>
      </div>
    </div>
  );
}
