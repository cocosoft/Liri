import { useTranslation } from "react-i18next";
import { ConfigSection } from "./ConfigComponents";

interface MigrationResultData {
  copied: number;
  skipped: number;
  errors: string[];
  cleaned?: number;
  cleanedErrors?: string[];
}

interface DataStoragePanelProps {
  isDark: boolean;
  configuredDirectory: string | null;
  defaultDirectory: string;
  dataDirectory: string;
  envLiriHome: string | null;
  envLiriDataDir: string | null;
  setDataDirectory: (dir: string) => void;
  dataDirError: string | null;
  dataDirSaved: boolean;
  migrateData: boolean;
  setMigrateData: (migrate: boolean) => void;
  migrating: boolean;
  migrationResult: MigrationResultData | null;
  handleSaveDataDirectory: () => void;
  handleResetDataDirectory: () => void;
}

function MigrationResult({ result }: { result: MigrationResultData }) {
  const { t } = useTranslation();
  return (
    <div
      className={`mt-3 p-3 rounded ${
        result.errors.length > 0
          ? "bg-yellow-50 dark:bg-yellow-900/20"
          : "bg-green-50 dark:bg-green-900/20"
      }`}
    >
      <p className="text-sm text-gray-700 dark:text-gray-300">
        {t("settings.dataMigrateDone")}
        <span className="font-medium">{result.copied}</span>{" "}
        {t("settings.dataMigrateCopiedSkipped", { skipped: result.skipped })}
      </p>
      {result.cleaned !== undefined && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {t("settings.dataCleanedInfo", { n: result.cleaned })}
        </p>
      )}
      {result.errors.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-red-500">
            {t("settings.dataMigrateErrors")}
          </p>
          {result.errors.slice(0, 3).map((err, idx) => (
            <p key={idx} className="text-xs text-red-500">
              {err}
            </p>
          ))}
        </div>
      )}
      {result.cleanedErrors && result.cleanedErrors.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-yellow-500">
            {t("settings.dataCleanWarnings")}
          </p>
          {result.cleanedErrors.slice(0, 3).map((err, idx) => (
            <p key={idx} className="text-xs text-yellow-500">
              {err}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** 数据存储管理面板 — 从 SettingsPage.tsx 内联内容提取 */
function DataStoragePanel({
  isDark,
  configuredDirectory,
  defaultDirectory,
  dataDirectory,
  envLiriHome,
  envLiriDataDir,
  setDataDirectory,
  dataDirError,
  dataDirSaved,
  migrateData,
  setMigrateData,
  migrating,
  migrationResult,
  handleSaveDataDirectory,
  handleResetDataDirectory,
}: DataStoragePanelProps) {
  const { t } = useTranslation();
  const effectiveDir = configuredDirectory || defaultDirectory || dataDirectory;
  let envInfo: string | null = null;
  if (
    envLiriHome &&
    configuredDirectory &&
    envLiriHome !== configuredDirectory
  ) {
    envInfo = t("settings.dataEnvLiriHomePriority", { dir: envLiriHome });
  } else if (envLiriHome && !configuredDirectory) {
    envInfo = t("settings.dataEnvLiriHome", { dir: envLiriHome });
  } else if (envLiriDataDir) {
    envInfo = t("settings.dataEnvLiriDataDir", { dir: envLiriDataDir });
  }

  return (
    <ConfigSection isDark={isDark}>
      <div className="mb-3 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-xs">
        <p className="text-blue-700 dark:text-blue-300">
          <span className="font-medium">{t("settings.dataEffectiveDir")}</span>
          <code className="ml-1">{effectiveDir}</code>
        </p>
        {envInfo && (
          <p className="text-yellow-600 dark:text-yellow-400 mt-1">
            ⚠️ {envInfo}
          </p>
        )}
      </div>

      <input
        type="text"
        value={dataDirectory}
        onChange={(e) => setDataDirectory(e.target.value)}
        placeholder={t("settings.dataDirPlaceholder")}
        className="w-full px-3 py-2 text-sm border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"
      />
      {configuredDirectory && (
        <p className="text-xs text-gray-500 mt-2">
          {t("settings.dataDirCustomConfigured")}
        </p>
      )}
      {!configuredDirectory && defaultDirectory && (
        <p className="text-xs text-gray-500 mt-2">
          {t("settings.dataDefaultDir", { dir: defaultDirectory })}
        </p>
      )}
      {dataDirError && (
        <p className="text-xs text-red-500 mt-2">{dataDirError}</p>
      )}
      <div className="flex items-center gap-2 mt-3">
        <input
          type="checkbox"
          id="migrateData"
          checked={migrateData}
          onChange={(e) => setMigrateData(e.target.checked)}
          className="w-4 h-4"
        />
        <label
          htmlFor="migrateData"
          className="text-sm text-gray-700 dark:text-gray-300"
        >
          {t("settings.dataMigrateExisting")}
        </label>
      </div>

      {migrating && (
        <div className="mt-3 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded">
          <div className="flex items-center gap-2">
            <span className="inline-block w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-amber-700 dark:text-amber-300">
              {t("settings.dataMigrating")}
            </span>
          </div>
        </div>
      )}

      {migrationResult && <MigrationResult result={migrationResult} />}
      <div className="flex gap-2 mt-3">
        <button
          onClick={handleSaveDataDirectory}
          disabled={migrating}
          className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t("settings.dataApply")}
        </button>
        {configuredDirectory && (
          <button
            onClick={handleResetDataDirectory}
            disabled={migrating}
            className="px-3 py-1.5 text-sm rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("settings.restoreDefault")}
          </button>
        )}
        {dataDirSaved && !migrationResult && (
          <span className="text-xs text-green-500 self-center">
            {t("settings.saved")}
          </span>
        )}
      </div>
    </ConfigSection>
  );
}

export default DataStoragePanel;
