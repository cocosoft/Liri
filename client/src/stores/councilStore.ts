/**
 * Council Store — 独立 Zustand Store
 *
 * 理事会辩论状态管理，含 SSE 流式事件订阅。
 * 原状态从 appStore 迁出，现已为真实独立 Store。
 *
 * 跨 Store 依赖：
 *   - useWorkspaceStore：获取当前 workspace ID
 *   - useToastStore：共识完成时弹 toast 通知
 */

import { create } from "zustand";
import { useWorkspaceStore } from "./workspaceStore";
import { useToastStore } from "./toastStore";
import { handleClientError } from "@/utils/handleError";

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
export type CouncilPhaseUI =
  "idle" | "convening" | "debating" | "consensus" | "completed" | "error";

/** 共识结果 */
export type ConsensusResultUI = "unanimous" | "majority" | "deadlock";

interface CouncilState {
  isActive: boolean;
  sessionId: string | null;
  phase: CouncilPhaseUI;
  topic: string;
  currentRound: number;
  statements: CouncilStatementUI[];
  joinedAgents: { agentId: string; agentName: string }[];
  result: ConsensusResultUI | null;
  finalProposal: string | null;
  minorityOpinion: string | null;
  error: string | null;
  eventSource: EventSource | null;

  startCouncil: (sessionId: string, topic: string) => void;
  addStatement: (statement: CouncilStatementUI) => void;
  addAgentJoined: (agentId: string, agentName: string) => void;
  setPhase: (phase: CouncilPhaseUI) => void;
  setRound: (round: number) => void;
  setResult: (
    result: ConsensusResultUI,
    finalProposal: string,
    minorityOpinion: string | null,
  ) => void;
  setError: (error: string) => void;
  setEventSource: (es: EventSource | null) => void;
  reset: () => void;
}

export const useCouncilStore = create<CouncilState>((set, get) => ({
  isActive: false,
  sessionId: null,
  phase: "idle",
  topic: "",
  currentRound: 0,
  statements: [],
  joinedAgents: [],
  result: null,
  finalProposal: null,
  minorityOpinion: null,
  error: null,
  eventSource: null,

  startCouncil: (sessionId, topic) => {
    const prev = get().eventSource;
    if (prev) {
      prev.close();
    }

    set({
      isActive: true,
      sessionId,
      topic,
      phase: "convening",
      currentRound: 0,
      statements: [],
      joinedAgents: [],
      result: null,
      finalProposal: null,
      minorityOpinion: null,
      error: null,
    });

    const workspaceId =
      useWorkspaceStore.getState().currentWorkspace?.id || "default";
    const API_BASE = "";

    const es = new EventSource(
      `${API_BASE}/v1/workspaces/${workspaceId}/council/${sessionId}/stream`,
    );

    es.addEventListener("council_started", () => {
      set({ phase: "convening" });
    });

    es.addEventListener("agent_joined", (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      set((state) => ({
        joinedAgents: [
          ...(state.joinedAgents || []),
          { agentId: data.agentId, agentName: data.agentName },
        ],
      }));
    });

    es.addEventListener("statement", (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      get().addStatement(data.statement);
    });

    es.addEventListener("round_started", (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      set({ phase: "debating", currentRound: data.round });
    });

    es.addEventListener("consensus_reached", (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      set({
        phase: "consensus",
        result: data.result,
        finalProposal: data.finalProposal,
        minorityOpinion: data.minorityOpinion,
      });
    });

    es.addEventListener("council_completed", () => {
      set({ phase: "completed" });
      useToastStore
        .getState()
        .addToast(
          "info",
          `\u{1F3DB}\uFE0F 理事会已达成共识："${get().topic}"`,
          5000,
        );
      es.close();
      set({ eventSource: null });
    });

    es.addEventListener("council_error", (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      set({
        phase: "error",
        error: data.error,
      });
      es.close();
      set({ eventSource: null });
    });

    es.addEventListener("error", (e) => {
      handleClientError(
        e instanceof ErrorEvent ? e : new Error("SSE 连接异常"),
        { module: "stores:councilStore", action: "councilSSE" },
        "warn",
      );
    });

    set({ eventSource: es });
  },

  addStatement: (statement) =>
    set((state) => ({ statements: [...state.statements, statement] })),

  addAgentJoined: (agentId, agentName) =>
    set((state) => ({
      joinedAgents: [...(state.joinedAgents || []), { agentId, agentName }],
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
    set({
      isActive: false,
      sessionId: null,
      phase: "idle",
      topic: "",
      currentRound: 0,
      statements: [],
      joinedAgents: [],
      result: null,
      finalProposal: null,
      minorityOpinion: null,
      error: null,
      eventSource: null,
    });
  },
}));
