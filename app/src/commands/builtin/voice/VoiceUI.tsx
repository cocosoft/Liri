import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface VoiceUIProps {
  onDone?: () => void;
  args?: string;
}

export function VoiceUI({ onDone, args = '' }: VoiceUIProps) {
  return (
    <CommandUI
      commandName="voice"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'voiceCommand', args)
      }
    />
  );
}
