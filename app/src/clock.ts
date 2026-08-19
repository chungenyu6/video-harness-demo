// The run clock.
//
// One clock drives every column, which is the whole reason two harnesses can be
// compared honestly: neither can look fast because it was started first. Live
// mode will drive the same hook from an SSE cursor instead of requestAnimationFrame.

import { useCallback, useEffect, useRef, useState } from "react";

export interface Clock {
  t: number;
  playing: boolean;
  speed: number;
  duration: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  step: (dir: 1 | -1, stops: number[]) => void;
  setSpeed: (s: number) => void;
  restart: () => void;
}

export function useClock(duration: number): Clock {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const raf = useRef<number | null>(null);
  const last = useRef<number>(0);

  useEffect(() => {
    setT(0);
    setPlaying(false);
  }, [duration]);

  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = ((now - last.current) / 1000) * speed;
      last.current = now;
      setT((prev) => {
        const next = prev + dt;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [playing, speed, duration]);

  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => setPlaying((p) => !p), []);
  const seek = useCallback(
    (v: number) => setT(Math.max(0, Math.min(duration, v))),
    [duration]
  );
  const restart = useCallback(() => {
    setT(0);
    setPlaying(true);
  }, []);

  const step = useCallback((dir: 1 | -1, stops: number[]) => {
    setPlaying(false);
    setT((prev) => {
      const eps = 1e-4;
      if (dir === 1) return stops.find((s) => s > prev + eps) ?? prev;
      const before = stops.filter((s) => s < prev - eps);
      return before.length ? before[before.length - 1] : 0;
    });
  }, []);

  return { t, playing, speed, duration, play, pause, toggle, seek, step, setSpeed, restart };
}
