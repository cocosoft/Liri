import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface ExportUIProps {
  onDone?: () => void;
  args?: string;
}

export function ExportUI({ onDone, args = '' }: ExportUIProps) {
  return (
    <CommandUI
      commandName="export"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'exportCommand', args)
      }
    />
  );
}
