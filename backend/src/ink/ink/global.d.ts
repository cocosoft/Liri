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

// Add any other global type declarations here
