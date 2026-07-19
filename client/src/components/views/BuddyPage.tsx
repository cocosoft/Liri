import { useEffect, useState } from "react";
import BuddyAvatar from "../Buddy/BuddyAvatar";
import DreamLogTab from "../Buddy/DreamLogTab";
import BuddyGame from "../Buddy/BuddyGame";
import BuddyEvolution from "../Buddy/BuddyEvolution";
import BuddyDreamDetail from "../Buddy/BuddyDreamDetail";
import { useBuddyStore } from "../../stores/buddyStore";
import {
  STAT_LABELS,
  SPECIES_MAP,
  RARITY_LABELS,
  RARITY_COLORS,
} from "../Buddy/buddySprites";
import type { BuddyStat } from "../../types";
import { useNavigationStore } from "../../stores/navigationStore";

const INTERACTIONS = ["pet", "feed", "play", "praise", "scold"];
const INTERACTION_LABELS: Record<string, string> = {
  pet: "抚摸",
  feed: "喂食",
  play: "玩耍",
  praise: "表扬",
  scold: "批评",
};

function BuddyPage() {
  const {
    companion,
    lastInteraction,
    stats,
    isLoading,
    loadBuddy,
    interact,
    loadStats,
  } = useBuddyStore();
  const setActivePage = useNavigationStore((s) => s.setActivePage);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<
    "overview" | "dreams" | "game" | "evolution" | "dreamDetail"
  >("overview");

  useEffect(() => {
    loadBuddy();
    loadStats();
  }, []);

  const handleInteract = async (action: string) => {
    await interact(action);
  };

  if (isLoading && !companion) {
    return (
      <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
        <div className="max-w-4xl mx-auto p-6">
          <div className="flex items-center justify-center h-64 text-gray-400">
            加载中...
          </div>
        </div>
      </div>
    );
  }

  if (!companion) {
    return (
      <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
        <div className="max-w-4xl mx-auto p-6">
          <div className="text-center py-12 text-gray-400 dark:text-gray-500">
            尚未孵化伙伴
          </div>
        </div>
      </div>
    );
  }

  const speciesInfo = SPECIES_MAP[companion.species];

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            我的伙伴
          </h2>
        </div>

        {/* Tab 切换 */}
        <div className="flex items-center gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab("overview")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "overview"
                ? "border-purple-500 text-purple-600 dark:text-purple-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            概览
          </button>
          <button
            onClick={() => setActiveTab("game")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "game"
                ? "border-purple-500 text-purple-600 dark:text-purple-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            🎮 游戏
          </button>
          <button
            onClick={() => setActiveTab("evolution")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "evolution"
                ? "border-purple-500 text-purple-600 dark:text-purple-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            ⬆️ 进化
          </button>
          <button
            onClick={() => setActiveTab("dreams")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "dreams"
                ? "border-purple-500 text-purple-600 dark:text-purple-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            🌙 梦境日志
          </button>
          <button
            onClick={() => setActiveTab("dreamDetail")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "dreamDetail"
                ? "border-purple-500 text-purple-600 dark:text-purple-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            ✨ 梦境详情
          </button>
        </div>

        {activeTab === "overview" ? (
          <>
            {/* Buddy 展示区 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 mb-6">
              <div className="flex flex-col items-center">
                <BuddyAvatar
                  species={companion.species}
                  rarity={companion.rarity}
                  eye={companion.eye}
                  hat={companion.hat}
                  shiny={companion.shiny}
                  size="lg"
                  showName
                  name={companion.name}
                />
                <div className="mt-4 text-center">
                  <div className="flex items-center gap-2 justify-center">
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {speciesInfo?.description || companion.species}
                    </span>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{
                        backgroundColor: RARITY_COLORS[companion.rarity] + "20",
                        color: RARITY_COLORS[companion.rarity],
                      }}
                    >
                      {RARITY_LABELS[companion.rarity]}
                    </span>
                  </div>
                  {companion.shiny && (
                    <span className="text-xs text-yellow-500 font-medium mt-1 block">
                      ✨ 闪光
                    </span>
                  )}
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    性格: {companion.personality}
                  </p>
                </div>
              </div>

              {/* 经验条 */}
              <div className="mt-6">
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                  <span>Lv.{companion.level}</span>
                  <span>
                    {companion.experience} / {companion.experienceToNext} XP
                  </span>
                </div>
                <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500 rounded-full transition-all"
                    style={{
                      width: `${(companion.experience / companion.experienceToNext) * 100}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* 属性面板 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 mb-6">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                属性
              </h3>
              <div className="grid grid-cols-5 gap-3">
                {(Object.entries(companion.stats) as [BuddyStat, number][]).map(
                  ([stat, value]) => (
                    <div key={stat} className="text-center">
                      <div className="text-lg">{STAT_LABELS[stat]?.icon}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {STAT_LABELS[stat]?.label}
                      </div>
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-0.5">
                        {value}
                      </div>
                    </div>
                  ),
                )}
              </div>
            </div>

            {/* 梦境整合统计 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 mb-6">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                🌙 梦境整合
              </h3>
              <div className="flex items-center justify-between text-sm">
                <div className="text-gray-500 dark:text-gray-400">
                  已完成整合
                </div>
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {stats?.dreamsCompleted ?? 0} 次
                </div>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <div className="text-gray-500 dark:text-gray-400">总经验值</div>
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {stats?.totalXp ?? 0} XP
                </div>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <div className="text-gray-500 dark:text-gray-400">互动次数</div>
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {stats?.interactions ?? 0} 次
                </div>
              </div>
              <button
                onClick={() => setActivePage("agent")}
                className="mt-3 w-full px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded transition-colors"
              >
                查看 Agent 任务
              </button>
            </div>

            {/* 互动区 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 mb-6">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                互动
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                {INTERACTIONS.map((action) => (
                  <button
                    key={action}
                    onClick={() => handleInteract(action)}
                    className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded transition-colors"
                  >
                    {INTERACTION_LABELS[action]}
                  </button>
                ))}
              </div>
              {lastInteraction && (
                <div className="mt-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded text-sm text-purple-700 dark:text-purple-300">
                  {lastInteraction.message}
                  {lastInteraction.statChanges &&
                    Object.keys(lastInteraction.statChanges).length > 0 && (
                      <div className="mt-1 flex gap-2 text-xs text-purple-500">
                        {Object.entries(lastInteraction.statChanges).map(
                          ([stat, change]) =>
                            change ? (
                              <span
                                key={stat}
                                className={
                                  change > 0 ? "text-green-500" : "text-red-500"
                                }
                              >
                                {STAT_LABELS[stat as BuddyStat]?.label}{" "}
                                {change > 0 ? "+" : ""}
                                {change}
                              </span>
                            ) : null,
                        )}
                      </div>
                    )}
                </div>
              )}
            </div>

            {/* 消息输入 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && message.trim()) {
                    interact(message.trim());
                    setMessage("");
                  }
                }}
                placeholder="和伙伴说话..."
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </>
        ) : activeTab === "game" ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <BuddyGame />
          </div>
        ) : activeTab === "evolution" ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <BuddyEvolution />
          </div>
        ) : activeTab === "dreamDetail" ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <BuddyDreamDetail />
          </div>
        ) : (
          <DreamLogTab />
        )}
      </div>
    </div>
  );
}

export default BuddyPage;
