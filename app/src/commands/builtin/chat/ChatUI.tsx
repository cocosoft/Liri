import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface ChatUIProps {
  onDone?: () => void;
  args?: string;
}

export function ChatUI({ onDone, args = '' }: ChatUIProps) {
  return (
    <CommandUI
      commandName="chat"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'chatCommand', args)
      }
    />
  );
}
