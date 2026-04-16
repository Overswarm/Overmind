import { useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { cleanBwString } from '../../types/replay';

export function ApmPanel() {
  const active = useAppStore((s) => s.active);

  const rows = useMemo(() => {
    if (!active) return [];
    const players = active.replay.Header?.Players ?? [];
    const descs = active.replay.Computed?.PlayerDescs ?? [];
    const descByPID = new Map<number, (typeof descs)[number]>();
    for (const d of descs) descByPID.set(d.PlayerID, d);
    return players
      .filter((p) => !p.Observer)
      .map((p) => {
        const d = descByPID.get(p.ID);
        const total = d?.CmdCount ?? 0;
        const eff = d?.EffectiveCmdCount ?? 0;
        const redundancy = total > 0 ? ((1 - eff / total) * 100) : 0;
        return {
          playerID: p.ID,
          name: cleanBwString(p.Name),
          apm: d?.APM ?? 0,
          eapm: d?.EAPM ?? 0,
          total,
          eff,
          redundancy,
        };
      });
  }, [active]);

  if (!active) return null;

  return (
    <div className="flex h-full flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]">
      <div className="border-b border-[var(--color-border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        APM / EAPM
      </div>
      <div className="flex-1 overflow-auto p-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
              <th className="py-1 text-left font-normal">Player</th>
              <th className="py-1 text-right font-normal">APM</th>
              <th className="py-1 text-right font-normal">EAPM</th>
              <th className="py-1 text-right font-normal">Redun.</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {rows.map((r, i) => (
              <tr key={r.playerID} className="border-t border-[var(--color-border)]">
                <td className="py-1 font-sans text-[var(--color-text-h)]">
                  <span
                    className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
                    style={{ background: i === 0 ? 'var(--color-player-a)' : 'var(--color-player-b)' }}
                  />
                  {r.name}
                </td>
                <td className="py-1 text-right text-[var(--color-text-h)]">{r.apm}</td>
                <td className="py-1 text-right text-[var(--color-text-h)]">{r.eapm}</td>
                <td className="py-1 text-right text-[var(--color-muted)]">{r.redundancy.toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 text-[10px] leading-relaxed text-[var(--color-muted)]">
          EAPM filters out redundant / spammed actions flagged by the screp
          engine. Redundancy % = 1 − EAPM / APM.
        </div>
      </div>
    </div>
  );
}
