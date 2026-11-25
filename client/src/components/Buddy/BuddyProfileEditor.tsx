import { useState } from "react";
import { useTranslation } from "react-i18next";
import BuddyAvatar from "./BuddyAvatar";
import { SPECIES_MAP } from "./buddySprites";
import { useBuddyStore } from "../../stores/buddyStore";
import type { BuddyCompanion, BuddySpecies } from "../../types";

/** 可选择的伙伴类型（物种）——顺序与玩法无关，取登记表键序 */
const SPECIES_OPTIONS = Object.keys(SPECIES_MAP) as BuddySpecies[];

interface BuddyProfileEditorProps {
  companion: BuddyCompanion;
  onClose: () => void;
}

/**
 * 伙伴资料编辑（2026-11-25）
 *
 * 用户可维护：**类型（物种）/ 名字 / 性格**；稀有度与属性仍由 userId 派生，不在此编辑。
 * 保存走 `PATCH /v1/buddy/companion`，成功后再关闭面板（失败留在面板内提示）。
 */
function BuddyProfileEditor({ companion, onClose }: BuddyProfileEditorProps) {
  const { t } = useTranslation();
  const updateCompanion = useBuddyStore((s) => s.updateCompanion);
  const [name, setName] = useState(companion.name);
  const [personality, setPersonality] = useState(companion.personality);
  const [species, setSpecies] = useState<BuddySpecies>(companion.species);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setFailed(false);
    const ok = await updateCompanion({ name, personality, species });
    setSaving(false);
    if (ok) {
      onClose();
      return;
    }
    setFailed(true);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-purple-200 dark:border-purple-800 p-4 mb-6">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
        {t("buddy.profileTitle")}
      </h3>

      <div className="mb-4">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          {t("buddy.profileSpecies")}
        </div>
        <div className="grid grid-cols-6 gap-2">
          {SPECIES_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSpecies(option)}
              className={`flex flex-col items-center p-2 rounded-lg border transition-colors ${
                species === option
                  ? "border-purple-500 bg-purple-50 dark:bg-purple-900/30"
                  : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
              }`}
              title={SPECIES_MAP[option].description}
            >
              <BuddyAvatar
                species={option}
                rarity={companion.rarity}
                eye={companion.eye}
                hat={companion.hat}
                shiny={companion.shiny}
                size="sm"
              />
            </button>
          ))}
        </div>
      </div>

      <label className="block mb-3">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t("buddy.profileName")}
        </span>
        <input
          type="text"
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("buddy.profileNamePlaceholder")}
          className="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100"
        />
      </label>

      <label className="block mb-3">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t("buddy.profilePersonality")}
        </span>
        <textarea
          value={personality}
          maxLength={120}
          rows={2}
          onChange={(e) => setPersonality(e.target.value)}
          placeholder={t("buddy.profilePersonalityPlaceholder")}
          className="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100"
        />
      </label>

      {failed && (
        <p className="text-xs text-red-500 mb-2">{t("buddy.profileSaveFailed")}</p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || name.trim().length === 0}
          className="px-3 py-1.5 text-sm rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {saving ? t("buddy.profileSaving") : t("buddy.profileSave")}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="px-3 py-1.5 text-sm rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
        >
          {t("buddy.profileCancel")}
        </button>
      </div>
    </div>
  );
}

export default BuddyProfileEditor;
