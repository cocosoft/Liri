/**
 * Council 辩论详情组件
 *
 * 当用户追问"让我看看讨论过程"时，展示多 Agent 辩论的完整过程：
 * - 辩论回合视图
 * - 各 Agent 立场和发言
 * - 投票结果
 * - 最终结论
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

// ========== 类型定义 ==========

/** 辩论回合 */
interface CouncilRound {
  round: number;
  agentId: string;
  agentName: string;
  content: string;
  stance: "support" | "oppose" | "neutral";
  confidence: number;
}

/** 投票结果 */
interface CouncilVote {
  agentId: string;
  agentName: string;
  vote: "support" | "oppose" | "abstain";
  reason: string;
}

/** 辩论详情 */
interface CouncilDetail {
  topic: string;
  rounds: CouncilRound[];
  conclusion: string;
  votes: CouncilVote[];
  startTime: string;
  endTime: string;
}

// ========== 组件 Props ==========

interface CouncilDetailViewProps {
  detail: CouncilDetail;
  isDark: boolean;
  onClose: () => void;
}

/** 立场配色 */
const STANCE_COLORS: Record<string, { bg: string; text: string }> = {
  support: {
    bg: "bg-green-100 dark:bg-green-900/30",
    text: "text-green-700 dark:text-green-400",
  },
  oppose: {
    bg: "bg-red-100 dark:bg-red-900/30",
    text: "text-red-700 dark:text-red-400",
  },
  neutral: {
    bg: "bg-gray-100 dark:bg-gray-800",
    text: "text-gray-600 dark:text-gray-400",
  },
};

const STANCE_LABELS: Record<string, string> = {
  support: "支持",
  oppose: "反对",
  neutral: "中立",
};

const VOTE_LABELS: Record<string, string> = {
  support: "支持",
  oppose: "反对",
  abstain: "弃权",
};

/**
 * Council 辩论详情组件
 */
function CouncilDetailView({
  detail,
  isDark,
  onClose,
}: CouncilDetailViewProps) {
  const { t } = useTranslation();
  const [selectedRound, setSelectedRound] = useState<number | null>(null);

  return (
    <div className={`p-4 ${isDark ? "text-gray-200" : "text-gray-800"}`}>
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">{t("workspace.council")}</h3>
          <p className="text-sm text-gray-500 mt-1">{detail.topic}</p>
        </div>
        <button
          onClick={onClose}
          className={`p-1 rounded hover:${isDark ? "bg-gray-700" : "bg-gray-200"}`}
        >
          ✕
        </button>
      </div>

      {/* 时间信息 */}
      <div className="flex gap-4 text-xs text-gray-500 mb-4">
        <span>开始: {new Date(detail.startTime).toLocaleTimeString()}</span>
        <span>结束: {new Date(detail.endTime).toLocaleTimeString()}</span>
        <span>共 {detail.rounds.length} 回合</span>
      </div>

      {/* 辩论回合 */}
      <div className="mb-6">
        <h4 className="text-sm font-semibold mb-2">辩论过程</h4>
        <div className="space-y-3">
          {detail.rounds.map((round) => (
            <div
              key={`${round.round}-${round.agentId}`}
              className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                selectedRound === round.round
                  ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-600"
                  : isDark
                    ? "border-gray-700 bg-gray-800 hover:bg-gray-750"
                    : "border-gray-200 bg-white hover:bg-gray-50"
              }`}
              onClick={() =>
                setSelectedRound(
                  selectedRound === round.round ? null : round.round,
                )
              }
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-gray-500">
                    R{round.round}
                  </span>
                  <span className="text-sm font-medium">{round.agentName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs ${STANCE_COLORS[round.stance].bg} ${STANCE_COLORS[round.stance].text}`}
                  >
                    {t(STANCE_LABELS[round.stance])}
                  </span>
                  <span className="text-xs text-gray-500">
                    置信度: {(round.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
              {selectedRound === round.round && (
                <div
                  className={`mt-2 p-2 rounded text-sm ${isDark ? "bg-gray-700" : "bg-gray-100"}`}
                >
                  {round.content}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 投票结果 */}
      <div className="mb-6">
        <h4 className="text-sm font-semibold mb-2">投票结果</h4>
        <div className="space-y-2">
          {detail.votes.map((vote) => (
            <div
              key={vote.agentId}
              className={`p-2 rounded-lg border text-sm ${
                isDark
                  ? "border-gray-700 bg-gray-800"
                  : "border-gray-200 bg-white"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{vote.agentName}</span>
                <span className="text-xs">{VOTE_LABELS[vote.vote]}</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">{vote.reason}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 最终结论 */}
      <div>
        <h4 className="text-sm font-semibold mb-2">
          {t("workspace.orchestration")}
        </h4>
        <div
          className={`p-3 rounded-lg border text-sm ${
            isDark
              ? "border-green-700 bg-green-900/20"
              : "border-green-300 bg-green-50"
          }`}
        >
          {detail.conclusion}
        </div>
      </div>
    </div>
  );
}

export default CouncilDetailView;
export type { CouncilDetail, CouncilRound, CouncilVote };
