// Macro-timing table: one row per race showing average gas / expo / tech /
// first-army / supply-100/150 seconds over the filtered replay set. When
// identities are configured, a second block shows "me vs opp" averages
// side-by-side with a delta, so you can see at a glance whether your expo
// is 30s later than your opponents'.

import type { CSSProperties } from 'react';
import type { Aggregate, AverageTimings } from '../analysis/aggregate';
import { formatTiming } from '../analysis/timings';

const ROWS: Array<[string, keyof AverageTimings]> = [
  ['First gas', 'firstGasSeconds'],
  ['First expo', 'firstExpansionSeconds'],
  ['First tech', 'firstTechBuildingSeconds'],
  ['First army unit', 'firstCombatUnitSeconds'],
  ['Supply 50', 'supply50Seconds'],
  ['Supply 100', 'supply100Seconds'],
  ['Supply 150', 'supply150Seconds'],
];

export function TimingsCard({ agg }: { agg: Aggregate }) {
  const raceKeys = Object.keys(agg.timingsByRace).sort();
  const showMeVsOpp = agg.me.games > 0;

  return (
    <div className="theme-panel rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        Avg macro timings
      </div>

      {raceKeys.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono tabular-nums">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                <th className="px-2 py-1 text-left">Metric</th>
                {raceKeys.map((r) => (
                  <th key={r} className="px-2 py-1 text-right">{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([label, key]) => (
                <tr key={key} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-1 text-[var(--color-muted)]">{label}</td>
                  {raceKeys.map((r) => (
                    <td key={r} className="px-2 py-1 text-right">
                      {formatTiming(agg.timingsByRace[r][key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showMeVsOpp && (
        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
            Me vs opponent (delta = me − opp)
          </div>
          <table className="w-full text-xs font-mono tabular-nums">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                <th className="px-2 py-1">Metric</th>
                <th className="px-2 py-1 text-right">Me</th>
                <th className="px-2 py-1 text-right">Opp</th>
                <th className="px-2 py-1 text-right">Δ</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([label, key]) => {
                const meV = agg.me.timingsMe[key];
                const oppV = agg.me.timingsOpp[key];
                const delta = meV != null && oppV != null ? meV - oppV : null;
                const deltaStyle: CSSProperties | undefined =
                  delta == null
                    ? undefined
                    : delta < -5
                      ? { color: 'var(--color-win)' }
                      : delta > 5
                        ? { color: 'var(--color-loss)' }
                        : undefined;
                return (
                  <tr key={key} className="border-t border-[var(--color-border)]">
                    <td className="px-2 py-1 text-[var(--color-muted)]">{label}</td>
                    <td className="px-2 py-1 text-right">{formatTiming(meV)}</td>
                    <td className="px-2 py-1 text-right">{formatTiming(oppV)}</td>
                    <td className="px-2 py-1 text-right text-[var(--color-muted)]" style={deltaStyle}>
                      {delta == null
                        ? '—'
                        : `${delta > 0 ? '+' : ''}${Math.round(delta)}s`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
