'use client';

import styles from './Spinner.module.css';

interface SpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  color?: string;
}

export default function Spinner({ size = 'md', color = 'currentColor' }: SpinnerProps) {
  const sizeMap = {
    xs: '12px',
    sm: '16px',
    md: '20px',
    lg: '24px',
  };

  const spinnerSize = sizeMap[size];

  return (
    <div className={styles.spinner} style={{ color, width: spinnerSize, height: spinnerSize }}>
      <svg
        className={styles.spinnerSvg}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className={styles.spinnerCircle}
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          className={styles.spinnerPath}
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    </div>
  );
}

