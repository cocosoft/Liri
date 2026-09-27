/**
 * CreateProjectModal — 新建项目弹窗
 * P0b: 同时创建后端 Project 实体 + 前端 worktree，ID 统一
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { useRootStore } from "@/stores/root-store";
import { createProject } from "@/services/projectArtifactService";

interface Props {
  onClose: () => void;
}

export default function CreateProjectModal({ onClose }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const createWorkspace = useRootStore((s) => s.createWorkspace);
  const navigate = useNavigate();

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("workspace.selectProjectFolder"),
      });
      if (typeof selected === "string") {
        setPath(selected);
      }
    } catch {
      // 非 Tauri 环境（浏览器 dev）下无系统对话框，保持手动输入
    }
  };

  const handleSubmit = async () => {
    setError("");

    if (!name.trim()) {
      setError(t("workspace.nameRequired"));
      return;
    }
    if (!path.trim()) {
      setError(t("workspace.pathRequired"));
      return;
    }

    setSubmitting(true);
    try {
      // P0b: 先调用后端创建 Project 实体，获得 projectId
      const project = await createProject({
        name: name.trim(),
        description: description.trim() || undefined,
        sandboxPath: path.trim(),
      });
      // 用 projectId 作为 worktree ID，前端同步创建 worktree
      createWorkspace({
        id: project.id,
        name: name.trim(),
        path: path.trim(),
        description: description.trim() || undefined,
        workspaceSource: "user",
        workspaceType: "project",
      });
      navigate(`/projects/${project.id}`);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
          {t("workspace.newProject")}
        </h2>

        {/* 名称 */}
        <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
          {t("workspace.projectName")}
        </label>
        <input
          type="text"
          className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 mb-3 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          placeholder={t("workspace.projectNamePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />

        {/* 路径 */}
        <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
          {t("workspace.localPath")}
        </label>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            placeholder={t("workspace.localPathPlaceholder")}
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
          <button
            onClick={handleSelectFolder}
            className="px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap"
          >
            {t("workspace.selectFolder")}
          </button>
        </div>

        {/* 描述 */}
        <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
          {t("workspace.descriptionOptional")}
        </label>
        <textarea
          className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 mb-4 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 resize-none"
          placeholder={t("workspace.projectDescPlaceholder")}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {/* 错误 */}
        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

        {/* 按钮 */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? t("workspace.creatingNow") : t("common.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
