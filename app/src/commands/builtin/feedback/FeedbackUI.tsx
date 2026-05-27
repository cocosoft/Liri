import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface FeedbackUIProps {
  onDone?: () => void;
  args?: string;
}

export function FeedbackUI({ onDone, args = '' }: FeedbackUIProps) {
  return (
    <CommandUI
      commandName="feedback"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'feedbackCommand', args)
      }
    />
  );
}
