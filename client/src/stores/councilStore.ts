/**
 * 向后兼容 — 已合并到 appStore
 *
 * 原独立 Store 已合并到 appStore，此文件为薄封装层。
 * 新代码请直接使用 useAppStore。
 */
import { useAppStore } from "./appStore";
import type { CouncilStatementUI, CouncilPhaseUI, ConsensusResultUI } from "./appStore";

export type { CouncilStatementUI, CouncilPhaseUI, ConsensusResultUI };

/** Council 状态切片 */
interface CouncilSlice {
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
  setResult: (result: ConsensusResultUI, finalProposal: string, minorityOpinion: string | null) => void;
  setError: (error: string) => void;
  setEventSource: (es: EventSource | null) => void;
  reset: () => void;
}

function councilSlice(s: any): CouncilSlice {
  return {
    isActive: s.councilIsActive,
    sessionId: s.councilSessionId,
    phase: s.councilPhase,
    topic: s.councilTopic,
    currentRound: s.councilCurrentRound,
    statements: s.councilStatements,
    joinedAgents: s.councilJoinedAgents,
    result: s.councilResult,
    finalProposal: s.councilFinalProposal,
    minorityOpinion: s.councilMinorityOpinion,
    error: s.councilError,
    eventSource: s.councilEventSource,
    startCouncil: s.startCouncil,
    addStatement: s.addStatement,
    addAgentJoined: s.addAgentJoined,
    setPhase: s.setCouncilPhase,
    setRound: s.setCouncilRound,
    setResult: s.setCouncilResult,
    setError: s.setCouncilError,
    setEventSource: s.setCouncilEventSource,
    reset: s.resetCouncil,
  };
}

export function useCouncilStore(): CouncilSlice;
export function useCouncilStore<T>(selector: (slice: CouncilSlice) => T): T;
export function useCouncilStore(selector?: any): any {
  const isActive = useAppStore((s) => s.councilIsActive);
  const sessionId = useAppStore((s) => s.councilSessionId);
  const phase = useAppStore((s) => s.councilPhase);
  const topic = useAppStore((s) => s.councilTopic);
  const currentRound = useAppStore((s) => s.councilCurrentRound);
  const statements = useAppStore((s) => s.councilStatements);
  const joinedAgents = useAppStore((s) => s.councilJoinedAgents);
  const result = useAppStore((s) => s.councilResult);
  const finalProposal = useAppStore((s) => s.councilFinalProposal);
  const minorityOpinion = useAppStore((s) => s.councilMinorityOpinion);
  const error = useAppStore((s) => s.councilError);
  const eventSource = useAppStore((s) => s.councilEventSource);
  const startCouncil = useAppStore((s) => s.startCouncil);
  const addStatement = useAppStore((s) => s.addStatement);
  const addAgentJoined = useAppStore((s) => s.addAgentJoined);
  const setPhase = useAppStore((s) => s.setCouncilPhase);
  const setRound = useAppStore((s) => s.setCouncilRound);
  const setResult = useAppStore((s) => s.setCouncilResult);
  const setError = useAppStore((s) => s.setCouncilError);
  const setEventSource = useAppStore((s) => s.setCouncilEventSource);
  const reset = useAppStore((s) => s.resetCouncil);
  const slice: CouncilSlice = { isActive, sessionId, phase, topic, currentRound, statements, joinedAgents, result, finalProposal, minorityOpinion, error, eventSource, startCouncil, addStatement, addAgentJoined, setPhase, setRound, setResult, setError, setEventSource, reset };
  return selector ? selector(slice) : slice;
}

useCouncilStore.getState = () => councilSlice(useAppStore.getState());
useCouncilStore.setState = (partial: Partial<CouncilSlice>) => {
  useAppStore.setState({
    ...(partial.isActive !== undefined && { councilIsActive: partial.isActive }),
    ...(partial.sessionId !== undefined && { councilSessionId: partial.sessionId }),
    ...(partial.phase !== undefined && { councilPhase: partial.phase }),
    ...(partial.topic !== undefined && { councilTopic: partial.topic }),
    ...(partial.currentRound !== undefined && { councilCurrentRound: partial.currentRound }),
    ...(partial.statements !== undefined && { councilStatements: partial.statements }),
    ...(partial.joinedAgents !== undefined && { councilJoinedAgents: partial.joinedAgents }),
    ...(partial.result !== undefined && { councilResult: partial.result }),
    ...(partial.finalProposal !== undefined && { councilFinalProposal: partial.finalProposal }),
    ...(partial.minorityOpinion !== undefined && { councilMinorityOpinion: partial.minorityOpinion }),
    ...(partial.error !== undefined && { councilError: partial.error }),
    ...(partial.eventSource !== undefined && { councilEventSource: partial.eventSource }),
  } as any);
};
