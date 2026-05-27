import type {
  AcpRuntimeSessionMode,
  AcpRuntimePromptMode,
} from './runtime/types.js';

export interface InteractionMode {
  sessionMode: AcpRuntimeSessionMode;
  promptMode: AcpRuntimePromptMode;
}

export function resolveInteractionMode(params: {
  resumeSessionId?: string;
}): InteractionMode {
  if (params.resumeSessionId) {
    return {
      sessionMode: 'persistent',
      promptMode: 'prompt',
    };
  }
  return {
    sessionMode: 'oneshot',
    promptMode: 'prompt',
  };
}

export function interactionModeToString(mode: InteractionMode): string {
  return `${mode.sessionMode}/${mode.promptMode}`;
}
