/**
 * Council Store — Agent 理事会状态管理
 *
 * 管理 Council 会话的辩论状态、发言记录和 SSE 流式订阅
 */
import { create } from "zustand";

/** 从后端流式事件中提取的发言 */
export interface CouncilStatementUI {
  id: string;
  agentId: string;
  agentName: string;
  round: number;
  type: "position" | "rebuttal" | "supplement" | "final";
  content: string;
  keyPoints: string[];
  timestamp: number;
}

/** Council 辩论阶段 */
export type CouncilPhaseUI = "convening" | "debating" | "consensus" | "completed";

/** 共识结果 */
export type ConsensusResultUI = "unanimous" | "majority" | "deadlock";

/** Council 状态 */
interface CouncilState {
  /** 是否正在辩论中 */
  isActive: boolean;
  /** 当前会话 ID */
  sessionId: string | null;
  /** 当前阶段 */
  phase: CouncilPhaseUI;
  /** 议题 */
  topic: string;
  /** 当前轮次 */
  currentRound: number;
  /** 所有发言记录 */
  statements: CouncilStatementUI[];
  /** 共识结果 */
  result: ConsensusResultUI | null;
  /** 最终方案 */
  finalProposal: string | null;
  /** 少数派意见 */
  minorityOpinion: string | null;
  /** 错误信息 */
  error: string | null;
  /** EventSource 实例 */
  eventSource: EventSource | null;

  /** 动作 */
  startCouncil: (sessionId: string, topic: string) => void;
  addStatement: (statement: CouncilStatementUI) => void;
  setPhase: (phase: CouncilPhaseUI) => void;
  setRound: (round: number) => void;
  setResult: (result: ConsensusResultUI, finalProposal: string, minorityOpinion: string | null) => void;
  setError: (error: string) => void;
  setEventSource: (es: EventSource | null) => void;
  reset: () => void;
}

const initialState = {
  isActive: false,
  sessionId: null,
  phase: "convening" as CouncilPhaseUI,
  topic: "",
  currentRound: 0,
  statements: [] as CouncilStatementUI[],
  result: null,
  finalProposal: null,
  minorityOpinion: null,
  error: null,
  eventSource: null,
};

export const useCouncilStore = create<CouncilState>((set, get) => ({
  ...initialState,

  startCouncil: (sessionId, topic) =>
    set({
      isActive: true,
      sessionId,
      topic,
      phase: "convening",
      currentRound: 0,
      statements: [],
      result: null,
      finalProposal: null,
      minorityOpinion: null,
      error: null,
    }),

  addStatement: (statement) =>
    set((state) => ({
      statements: [...state.statements, statement],
    })),

  setPhase: (phase) => set({ phase }),

  setRound: (round) => set({ currentRound: round }),

  setResult: (result, finalProposal, minorityOpinion) =>
    set({ result, finalProposal, minorityOpinion }),

  setError: (error) => set({ error, isActive: false }),

  setEventSource: (es) => set({ eventSource: es }),

  reset: () => {
    const { eventSource } = get();
    if (eventSource) {
      eventSource.close();
    }
    set({ ...initialState });
  },
}));