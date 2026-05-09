/**
 * 加载动画组件
 */

import React, { useState, useEffect } from 'react';

export interface SpinnerProps {
  size?: 'small' | 'medium' | 'large';
  color?: 'primary' | 'secondary' | 'success' | 'warning' | 'error';
  text?: string;
  variant?: 'dots' | 'bars' | 'circle' | 'pulse';
  visible?: boolean;
}

export const Spinner: React.FC<SpinnerProps> = ({
  size = 'medium',
  color = 'primary',
  text,
  variant = 'dots',
  visible = true,
}) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!visible) return;

    const interval = setInterval(() => {
      setFrame((prev) => (prev + 1) % 8);
    }, 120);

    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  const sizeClasses = {
    small: 'spinner-small',
    medium: 'spinner-medium',
    large: 'spinner-large',
  };

  const colorClasses = {
    primary: 'spinner-primary',
    secondary: 'spinner-secondary',
    success: 'spinner-success',
    warning: 'spinner-warning',
    error: 'spinner-error',
  };

  const renderDots = () => (
    <div className={`spinner-dots ${sizeClasses[size]} ${colorClasses[color]}`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="dot"
          style={{ animationDelay: `${i * 100}ms` }}
        />
      ))}
    </div>
  );

  const renderBars = () => (
    <div className={`spinner-bars ${sizeClasses[size]} ${colorClasses[color]}`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="bar"
          style={{
            height: `${20 + ((frame + i) % 5) * 16}%`,
            animationDelay: `${i * 80}ms`,
          }}
        />
      ))}
    </div>
  );

  const renderCircle = () => (
    <div
      className={`spinner-circle ${sizeClasses[size]} ${colorClasses[color]}`}
    >
      <svg viewBox="0 0 50 50">
        <circle
          className="circle-path"
          cx="25"
          cy="25"
          r="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="100"
          strokeDashoffset={`${25 - frame * 3.125}`}
          style={{
            transform: 'rotate(-90deg)',
            transformOrigin: '50% 50%',
          }}
        />
      </svg>
    </div>
  );

  const renderPulse = () => (
    <div
      className={`spinner-pulse ${sizeClasses[size]} ${colorClasses[color]}`}
    >
      <span className="pulse-ring" />
      <span className="pulse-ring delay-1" />
      <span className="pulse-ring delay-2" />
    </div>
  );

  const renderSpinner = () => {
    switch (variant) {
      case 'bars':
        return renderBars();
      case 'circle':
        return renderCircle();
      case 'pulse':
        return renderPulse();
      default:
        return renderDots();
    }
  };

  return (
    <div className="spinner-container">
      {renderSpinner()}
      {text && <span className="spinner-text">{text}</span>}
    </div>
  );
};

export function createSpinner(
  props?: Partial<SpinnerProps>
): React.ReactElement {
  return <Spinner {...props} />;
}
