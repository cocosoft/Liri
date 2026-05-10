import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface InsightsUIProps {
  onDone?: () => void;
  args?: string;
}

export function InsightsUI({ onDone, args = '' }: InsightsUIProps) {
  return (
    <CommandUI
      commandName="insights"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'insightsCommand', args)
      }
    />
  );
}
