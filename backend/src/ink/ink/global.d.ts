// Global type declarations for Ink

declare module '*.tsx' {
  import React from 'react';
  const Component: React.FC<any>;
  export default Component;
}

declare module '*.ts' {
  const value: any;
  export default value;
}

declare module './components/AlternateScreen' {
  export default function AlternateScreen(props: Record<string, unknown>): JSX.Element;
}

declare module './components/NoSelect' {
  export default function NoSelect(props: Record<string, unknown>): JSX.Element;
}

declare module './components/RawAnsi' {
  export default function RawAnsi(props: Record<string, unknown>): JSX.Element;
}

// Add any other global type declarations here
