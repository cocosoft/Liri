import { useTranslation } from "react-i18next";
import DreamLogTab from "../Buddy/DreamLogTab";

function DreamPage() {
  const { t } = useTranslation();
  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto p-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          {t("dream.title")}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          {t("dream.desc")}
        </p>
        <DreamLogTab />
      </div>
    </div>
  );
}

export default DreamPage;
