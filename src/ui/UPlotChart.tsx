// Minimal React wrapper around uPlot. Creates the plot on mount and updates
// data / size in response to prop changes without tearing down the instance.

import { useEffect, useLayoutEffect, useRef } from 'react';
import uPlot, { type AlignedData, type Options } from 'uplot';

interface Props {
  data: AlignedData;
  options: Omit<Options, 'width' | 'height'> & { width?: number; height?: number };
  className?: string;
}

export function UPlotChart({ data, options, className }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  // Create plot once.
  useLayoutEffect(() => {
    if (!hostRef.current) return;
    const rect = hostRef.current.getBoundingClientRect();
    const opts: Options = {
      ...options,
      width: options.width ?? Math.max(200, Math.floor(rect.width)),
      height: options.height ?? Math.max(120, Math.floor(rect.height)),
    };
    plotRef.current = new uPlot(opts, data, hostRef.current);
    return () => {
      plotRef.current?.destroy();
      plotRef.current = null;
    };
    // Intentionally not depending on options/data: full rebuild happens on
    // unmount/remount only. Data/size updates go through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data updates.
  useEffect(() => {
    plotRef.current?.setData(data);
  }, [data]);

  // Resize observer for fluid layouts.
  useEffect(() => {
    if (!hostRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || !plotRef.current) return;
      const { width, height } = entry.contentRect;
      plotRef.current.setSize({ width: Math.max(200, Math.floor(width)), height: Math.max(120, Math.floor(height)) });
    });
    obs.observe(hostRef.current);
    return () => obs.disconnect();
  }, []);

  return <div ref={hostRef} className={className} />;
}
