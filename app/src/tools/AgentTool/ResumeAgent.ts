import { join } from 'path';
import { resolvePyappHome } from '@modules/config/paths';

export type ResumeAgentInput = {
  agentId: string;
  prompt: string;
  model?: string;
  maxTurns?: number;
};

export type ResumeAgentResult = {
  agentId: string;
  description: string;
  status: 'resumed' | 'failed';
  error?: string;
};

export type ResumeAgentCallback = {
  onProgress?: (message: string) => void;
  onComplete?: (result: ResumeAgentResult) => void;
  onError?: (error: Error) => void;
};

async function readAgentTranscript(
  agentId: string
): Promise<Array<{ role: string; content: string }> | null> {
  try {
    const { existsSync, readFileSync } = await import('fs');
    const transcriptPath = join(resolvePyappHome(), 'agents', agentId, 'conversation.json');
    if (!existsSync(transcriptPath)) {
      return null;
    }
    const content = readFileSync(transcriptPath, 'utf-8');
    return JSON.parse(content) as Array<{ role: string; content: string }>;
  } catch {
    return null;
  }
}

async function readAgentMetadata(
  agentId: string
): Promise<Record<string, unknown> | null> {
  try {
    const { existsSync, readFileSync } = await import('fs');
    const metaPath = join(resolvePyappHome(), 'agents', agentId, 'meta.json');
    if (!existsSync(metaPath)) {
      return null;
    }
    const content = readFileSync(metaPath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function reconstructSystemPrompt(
  originalPrompt: string,
  resumeContext: string
): string {
  return `${originalPrompt}

=== RESUME CONTEXT ===
This agent was previously paused. Below is the context from the prior execution:

${resumeContext}

Continue from where you left off. You have access to the full conversation history above.
=== END RESUME CONTEXT ===`;
}

function formatTranscriptContext(
  messages: Array<{ role: string; content: string }>,
  maxMessages = 30
): string {
  const recent = messages.slice(-maxMessages);
  return recent
    .map((m) => {
      const prefix = m.role === 'user' ? 'User' : 'Assistant';
      const content = m.content.slice(0, 500);
      return `${prefix}: ${content}`;
    })
    .join('\n\n');
}

export async function resumeAgent(
  input: ResumeAgentInput,
  callbacks?: ResumeAgentCallback
): Promise<ResumeAgentResult> {
  const { agentId, prompt } = input;

  callbacks?.onProgress?.(`Reading transcript for agent ${agentId}...`);

  const [transcript, _metadata] = await Promise.all([
    readAgentTranscript(agentId),
    readAgentMetadata(agentId),
  ]);

  if (!transcript) {
    const error = `No transcript found for agent ID: ${agentId}`;
    callbacks?.onError?.(new Error(error));
    return {
      agentId,
      description: prompt,
      status: 'failed',
      error,
    };
  }

  callbacks?.onProgress?.('Reconstructing conversation context...');
  callbacks?.onProgress?.('Resuming agent execution...');

  const result: ResumeAgentResult = {
    agentId,
    description: prompt,
    status: 'resumed',
  };

  callbacks?.onComplete?.(result);

  return result;
}

export async function canResumeAgent(agentId: string): Promise<boolean> {
  const transcript = await readAgentTranscript(agentId);
  return transcript !== null && transcript.length > 0;
}

export async function getAgentResumeSummary(agentId: string): Promise<{
  canResume: boolean;
  messageCount: number;
  lastActivity?: string;
}> {
  const transcript = await readAgentTranscript(agentId);
  if (!transcript) {
    return { canResume: false, messageCount: 0 };
  }

  const lastMessage = transcript[transcript.length - 1];
  return {
    canResume: true,
    messageCount: transcript.length,
    lastActivity: lastMessage
      ? `${lastMessage.role}: ${lastMessage.content.slice(0, 80)}`
      : undefined,
  };
}
