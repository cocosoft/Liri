import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";

interface MediaFile {
  id: string;
  name: string;
  type: "image" | "video" | "audio" | "document";
  size: number;
  uploadedAt: string;
  tags: string[];
}

function MediaPage() {
  const { t } = useTranslation();
  const { config, loadConfig } = useConfigStore();
  const isDark = config.theme === "dark";
  const [files, setFiles] = useState<MediaFile[]>([
    {
      id: "1",
      name: "avatar.png",
      type: "image",
      size: 102400,
      uploadedAt: "2026-05-28 10:00",
      tags: ["profile", "avatar"],
    },
    {
      id: "2",
      name: "demo-video.mp4",
      type: "video",
      size: 5242880,
      uploadedAt: "2026-05-27 15:30",
      tags: ["demo", "tutorial"],
    },
    {
      id: "3",
      name: "audio-note.mp3",
      type: "audio",
      size: 204800,
      uploadedAt: "2026-05-27 14:00",
      tags: ["voice", "note"],
    },
    {
      id: "4",
      name: "report.pdf",
      type: "document",
      size: 1048576,
      uploadedAt: "2026-05-26 09:00",
      tags: ["report", "business"],
    },
    {
      id: "5",
      name: "banner.jpg",
      type: "image",
      size: 307200,
      uploadedAt: "2026-05-25 11:00",
      tags: ["banner", "marketing"],
    },
    {
      id: "6",
      name: "presentation.pptx",
      type: "document",
      size: 2097152,
      uploadedAt: "2026-05-24 16:00",
      tags: ["presentation", "meeting"],
    },
  ]);
  const [filter, setFilter] = useState<
    "all" | "image" | "video" | "audio" | "document"
  >("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const filteredFiles = files.filter((file) => {
    const matchesFilter = filter === "all" || file.type === filter;
    const matchesSearch =
      searchQuery === "" ||
      file.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      file.tags.some((tag) =>
        tag.toLowerCase().includes(searchQuery.toLowerCase()),
      );
    return matchesFilter && matchesSearch;
  });

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "image":
        return "🖼️";
      case "video":
        return "🎬";
      case "audio":
        return "🎵";
      case "document":
        return "📄";
      default:
        return "📁";
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "image":
        return t("media.image");
      case "video":
        return t("media.video");
      case "audio":
        return t("media.audio");
      case "document":
        return t("media.document");
      default:
        return t("media.other");
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "image":
        return isDark
          ? "bg-green-900/30 text-green-400"
          : "bg-green-100 text-green-700";
      case "video":
        return isDark
          ? "bg-red-900/30 text-red-400"
          : "bg-red-100 text-red-700";
      case "audio":
        return isDark
          ? "bg-purple-900/30 text-purple-400"
          : "bg-purple-100 text-purple-700";
      case "document":
        return isDark
          ? "bg-blue-900/30 text-blue-400"
          : "bg-blue-100 text-blue-700";
      default:
        return isDark
          ? "bg-gray-700 text-gray-400"
          : "bg-gray-100 text-gray-600";
    }
  };

  const toggleSelect = (fileId: string) => {
    setSelectedFiles((prev) =>
      prev.includes(fileId)
        ? prev.filter((id) => id !== fileId)
        : [...prev, fileId],
    );
  };

  const deleteSelected = () => {
    setFiles((prev) => prev.filter((file) => !selectedFiles.includes(file.id)));
    setSelectedFiles([]);
  };

  return (
    <div
      className={`flex-1 overflow-y-auto ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1
              className={`text-2xl font-bold ${isDark ? "text-gray-100" : "text-gray-900"}`}
            >
              {t("media.title")}
            </h1>
            <p
              className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              {t("media.manageDesc")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {selectedFiles.length > 0 && (
              <>
                <span
                  className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("media.selectedCount", { count: selectedFiles.length })}
                </span>
                <button
                  onClick={deleteSelected}
                  className={`px-3 py-1.5 text-sm rounded-lg ${isDark ? "bg-red-900/30 hover:bg-red-900/50 text-red-400" : "bg-red-50 hover:bg-red-100 text-red-600"}`}
                >
                  {t("media.deleteSelected")}
                </button>
              </>
            )}
            <button
              className={`px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg`}
            >
              {t("chat.uploadFile")}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <div
            className={`flex-1 relative ${isDark ? "bg-gray-800" : "bg-white"} rounded-lg border ${isDark ? "border-gray-700" : "border-gray-200"} px-3 py-2`}
          >
            <svg
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder={t("media.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full pl-9 text-sm ${isDark ? "bg-transparent text-gray-100 placeholder-gray-500" : "bg-transparent text-gray-900 placeholder-gray-500"}`}
            />
          </div>
          <div className="flex gap-2">
            {(["all", "image", "video", "audio", "document"] as const).map(
              (f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    filter === f
                      ? "bg-blue-600 text-white"
                      : isDark
                        ? "bg-gray-700 hover:bg-gray-600 text-gray-300"
                        : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                  }`}
                >
                  {f === "all" ? t("common.all") : getTypeLabel(f)}
                </button>
              ),
            )}
          </div>
        </div>

        <div
          className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"} p-6`}
        >
          {filteredFiles.length === 0 ? (
            <div className="text-center py-12">
              <p className={`${isDark ? "text-gray-400" : "text-gray-500"}`}>
                {t("media.noMedia")}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {filteredFiles.map((file) => (
                <div
                  key={file.id}
                  onClick={() => toggleSelect(file.id)}
                  className={`relative p-4 rounded-lg border cursor-pointer transition-colors ${
                    selectedFiles.includes(file.id)
                      ? isDark
                        ? "border-blue-500 bg-blue-900/20"
                        : "border-blue-500 bg-blue-50"
                      : isDark
                        ? "border-gray-700 bg-gray-700/50 hover:bg-gray-700"
                        : "border-gray-200 bg-gray-50 hover:bg-gray-100"
                  }`}
                >
                  <div
                    className={`absolute top-2 right-2 w-5 h-5 rounded border-2 flex items-center justify-center ${
                      selectedFiles.includes(file.id)
                        ? "bg-blue-600 border-blue-600"
                        : isDark
                          ? "border-gray-500"
                          : "border-gray-300"
                    }`}
                  >
                    {selectedFiles.includes(file.id) && (
                      <svg
                        className="w-3 h-3 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={3}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </div>

                  <div className="flex flex-col items-center text-center">
                    <div
                      className={`w-16 h-16 rounded-lg flex items-center justify-center text-3xl mb-3 ${isDark ? "bg-gray-700" : "bg-gray-100"}`}
                    >
                      {getTypeIcon(file.type)}
                    </div>
                    <p
                      className={`text-sm font-medium truncate w-full ${isDark ? "text-gray-100" : "text-gray-900"}`}
                    >
                      {file.name}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${getTypeColor(file.type)}`}
                      >
                        {getTypeLabel(file.type)}
                      </span>
                      <span
                        className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        {formatSize(file.size)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2 justify-center">
                      {file.tags.map((tag) => (
                        <span
                          key={tag}
                          className={`text-xs px-1.5 py-0.5 rounded ${isDark ? "bg-gray-600 text-gray-300" : "bg-gray-200 text-gray-600"}`}
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <p
                      className={`text-xs mt-2 ${isDark ? "text-gray-500" : "text-gray-400"}`}
                    >
                      {file.uploadedAt}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default MediaPage;
