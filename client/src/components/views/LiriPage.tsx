import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import BuddyAvatar from "../Buddy/BuddyAvatar";
import DreamLogTab from "../Buddy/DreamLogTab";
import BuddyGame from "../Buddy/BuddyGame";
import BuddyEvolution from "../Buddy/BuddyEvolution";
import BuddyDreamDetail from "../Buddy/BuddyDreamDetail";
import { useBuddyStore } from "../../stores/buddyStore";
import { useOperationProgressStore } from "../../stores/operationProgressStore";
import { memoryService } from "../../services/memoryService";
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

const PHASE_LABELS: Record<string, string> = {
  gather: "收集数据",
  analyze: "分析中",
  write: "写入记忆",
  index: "刷新索引",
};

function LiriPage() {
  const {
    companion,
    lastInteraction,
    stats,
    isLoading,
    loadBuddy,
    interact,
    loadStats,
  } = useBuddyStore();
  const operations = useOperationProgressStore((s) => s.operations);
  const dreamPhase = useOperationProgressStore((s) => s.dreamPhase);
  const dreamPhasesDone = useOperationProgressStore((s) => s.dreamPhasesDone);
  const _init = useOperationProgressStore((s) => s._init);
  const setActivePage = useNavigationStore((s) => s.setActivePage);
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const [triggering, setTriggering] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "overview" | "dreams" | "game" | "evolution" | "dreamDetail"
  >("overview");

  useEffect(() => {
    loadBuddy();
    loadStats();
    _init();
  }, []);

  const handleInteract = async (action: string) => {
    await interact(action);
  };

  const handleTriggerDream = async () => {
    setTriggering(true);
    try {
      await memoryService.triggerDream();
    } catch {
      /* 已由 memoryStore 处理 */
    }
    setTriggering(false);
  };

  // 梦境实时状态
  const dreamOp = operations.find((o) => o.id === "dream");

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
        <div className="max-w-2xl mx-auto p-6">
          <div className="text-center py-16">
            {/* 孵蛋动画 SVG */}
            <div className="mb-8">
              <svg viewBox="0 0 140 160" className="w-32 h-36 mx-auto">
                <defs>
                  <radialGradient id="eggGlow" cx="50%" cy="40%" r="50%">
                    <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                  </radialGradient>
                  <linearGradient
                    id="eggBody"
                    x1="0%"
                    y1="0%"
                    x2="0%"
                    y2="100%"
                  >
                    <stop offset="0%" stopColor="#c4b5fd" />
                    <stop offset="100%" stopColor="#8b5cf6" />
                  </linearGradient>
                </defs>
                {/* 光晕 */}
                <ellipse cx="70" cy="85" rx="60" ry="70" fill="url(#eggGlow)">
                  <animate
                    attributeName="rx"
                    values="60;65;60"
                    dur="3s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="ry"
                    values="70;75;70"
                    dur="3s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.6;1;0.6"
                    dur="3s"
                    repeatCount="indefinite"
                  />
                </ellipse>
                {/* 蛋体 */}
                <ellipse
                  cx="70"
                  cy="85"
                  rx="32"
                  ry="42"
                  fill="url(#eggBody)"
                  stroke="#7c3aed"
                  strokeWidth="1.5"
                >
                  <animate
                    attributeName="ry"
                    values="42;40;42"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                </ellipse>
                {/* 蛋壳纹理 */}
                <path
                  d="M54 70 Q58 55 70 50 Q82 55 86 70"
                  fill="none"
                  stroke="#a78bfa"
                  strokeWidth="0.8"
                  opacity="0.4"
                />
                <path
                  d="M50 85 Q55 75 65 72"
                  fill="none"
                  stroke="#a78bfa"
                  strokeWidth="0.6"
                  opacity="0.3"
                />
                <path
                  d="M90 85 Q85 75 75 72"
                  fill="none"
                  stroke="#a78bfa"
                  strokeWidth="0.6"
                  opacity="0.3"
                />
                {/* 心跳线 */}
                <path
                  d="M58 95 L64 95 L66 88 L68 102 L70 90 L72 95 L82 95"
                  fill="none"
                  stroke="#7c3aed"
                  strokeWidth="1"
                  opacity="0.5"
                >
                  <animate
                    attributeName="opacity"
                    values="0.3;0.6;0.3"
                    dur="1.5s"
                    repeatCount="indefinite"
                  />
                </path>
              </svg>
            </div>

            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-2">
              等待你的第一个伙伴
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto leading-relaxed mb-8">
              Liri 会在你与它对话时自动孵化出一个独一无二的伙伴。
              每次做梦、每次交互，它都会成长。
            </p>

            {/* 五阶段预览卡片 */}
            <div className="inline-flex gap-2 mb-8">
              {[
                { emoji: "💬", label: "交谈", desc: "与 Liri 对话" },
                { emoji: "🌙", label: "做梦", desc: "自动编织记忆" },
                { emoji: "⚡", label: "进化", desc: "获得经验成长" },
                { emoji: "🎨", label: "蜕变", desc: "解锁稀有形态" },
              ].map((step, _i) => (
                <div
                  key={step.label}
                  className="flex flex-col items-center gap-1 w-16"
                >
                  <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-800/30 flex items-center justify-center text-lg">
                    {step.emoji}
                  </div>
                  <span className="text-[10px] font-medium text-gray-600 dark:text-gray-400">
                    {step.label}
                  </span>
                  <span className="text-[9px] text-gray-400 dark:text-gray-500 leading-tight text-center">
                    {step.desc}
                  </span>
                </div>
              ))}
            </div>

            <button
              onClick={() => navigate("/chat")}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              去聊天，孵化你的伙伴
            </button>
          </div>
        </div>
      </div>
    );
  }

  const speciesInfo = SPECIES_MAP[companion.species];

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto p-6">
        {/* 标题 */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Liri
          </h2>
        </div>

        {/* 梦境实时管线可视化 */}
        {dreamPhase && (
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/40 dark:to-purple-950/40 rounded-lg border border-indigo-100 dark:border-indigo-900/50 p-4 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                🌙 Liri 正在做梦...
              </span>
              <span className="inline-block w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            </div>
            {/* 五阶段管线 */}
            <div className="flex items-center gap-1">
              {(
                ["gather", "analyze", "generate", "write", "index"] as const
              ).map((phase, i) => {
                const done = dreamPhasesDone.includes(phase);
                const active = dreamPhase === phase;
                return (
                  <div key={phase} className="flex-1 flex items-center">
                    <div
                      className={`flex-1 flex flex-col items-center ${active ? "scale-105" : ""} transition-transform`}
                    >
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold
                          ${done ? "bg-indigo-500 text-white" : active ? "bg-indigo-400 text-white ring-2 ring-indigo-300" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"}`}
                      >
                        {done ? "✓" : i + 1}
                      </div>
                      <span
                        className={`text-[9px] mt-1 text-center leading-tight
                        ${active ? "text-indigo-600 dark:text-indigo-400 font-semibold" : done ? "text-indigo-500 dark:text-indigo-400" : "text-gray-400"}`}
                      >
                        {PHASE_LABELS[phase]}
                      </span>
                    </div>
                    {i < 4 && (
                      <div
                        className={`w-4 h-0.5 -mt-3 ${dreamPhasesDone.includes(phase) ? "bg-indigo-400" : "bg-gray-200 dark:bg-gray-700"}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 梦境完成横幅 */}
        {!dreamPhase && dreamOp && dreamOp.progress === 1 && (
          <div className="bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-900/50 p-3 mb-4">
            <span className="text-sm text-green-700 dark:text-green-300">
              {dreamOp.label}
            </span>
          </div>
        )}

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
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleTriggerDream}
                  disabled={triggering || !!dreamPhase}
                  className="flex-1 px-3 py-2 text-sm bg-indigo-100 dark:bg-indigo-900/30 hover:bg-indigo-200 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded transition-colors disabled:opacity-50"
                >
                  {triggering
                    ? "触发中..."
                    : dreamPhase
                      ? "梦境进行中"
                      : "🌙 手动触发梦境"}
                </button>
                <button
                  onClick={() => setActivePage("agent")}
                  className="px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded transition-colors"
                >
                  Agent
                </button>
              </div>
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
                placeholder="和 Liri 说话..."
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

export default LiriPage;
