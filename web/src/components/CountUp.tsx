'use client';

import { useEffect, useState } from 'react';

type CountUpProps = {
  value: number;
  /** Milliseconds from 0 to value. */
  duration?: number;
  /** Milliseconds to hold 0 before counting. */
  delay?: number;
  suffix?: string;
};

// Counts from 0 to value whenever it mounts or the value changes, easing out; reduced motion shows the value at once.
export function CountUp({ value, duration = 1000, delay = 0, suffix = '' }: CountUpProps) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const instant = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now() + (instant ? 0 : delay);
    let frame = 0;
    const tick = (now: number) => {
      const progress = instant ? 1 : Math.min(1, Math.max(0, (now - start) / duration));
      setShown(Math.round(value * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, delay]);

  return (
    <>
      {shown.toLocaleString('ko-KR')}
      {suffix}
    </>
  );
}
