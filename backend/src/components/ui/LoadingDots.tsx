/**
 * LoadingDots组件 - 加载点动画
 */

import React, { useState, useEffect } from 'react';
import { Text } from '../ink.js';

interface LoadingDotsProps {
  color?: string;
  text?: string;
}

export function LoadingDots({ color = 'cyan', text = 'Loading' }: LoadingDotsProps): React.ReactNode {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCount((prev) => (prev + 1) % 4);
    }, 300);

    return () => clearInterval(interval);
  }, []);

  const dots = '.'.repeat(count);
  const padding = ' '.repeat(3 - count);

  return (
    <Text color={color}>
      {text}{dots}{padding}
    </Text>
  );
}
