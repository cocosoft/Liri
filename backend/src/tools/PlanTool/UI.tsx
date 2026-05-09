// import React from 'react'
import { Box, Text } from 'ink';

export type PlanOutput = {
  planName?: string;
  steps?: Array<{ step: number; description: string; status?: string }>;
  result?: string;
};

export function renderToolUseMessage(
  input: Partial<{ plan_name: string; description: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { plan_name, description } = input;
  const label = plan_name || 'Plan';

  if (verbose) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>Plan mode: </Text>
          <Text bold>{label}</Text>
        </Box>
        {description ? (
          <Box marginTop={1} marginLeft={2}>
            <Text dimColor>{description.slice(0, 100)}</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text dimColor>Plan: </Text>
      <Text bold>{label}</Text>
    </Box>
  );
}

export function renderToolResultMessage(
  output: PlanOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { planName, steps, result } = output;

  if (verbose && steps && steps.length > 0) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">✓ {planName || 'Plan'} created</Text>
          <Text dimColor>
            {' '}
            ({steps.length} step{steps.length !== 1 ? 's' : ''})
          </Text>
        </Box>
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          {steps.map((s) => (
            <Box key={s.step} flexDirection="row">
              <Text dimColor>{s.step}. </Text>
              <Text>{s.description.slice(0, 80)}</Text>
              {s.status ? <Text dimColor> [{s.status}]</Text> : null}
            </Box>
          ))}
        </Box>
      </Box>
    );
  }

  if (result) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">✓ </Text>
          <Text>{result.slice(0, 200)}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text>{planName || 'Plan'} completed</Text>
    </Box>
  );
}

export function getToolUseSummary(
  input: Partial<{ plan_name: string }> | undefined
): string | null {
  if (!input?.plan_name) return null;
  return `Plan: ${input.plan_name}`;
}
