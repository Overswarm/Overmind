// Rolling-winrate trend chart. Given the filtered digests sorted by start
// time, we plot:
//
//   - an overall rolling-winrate line (me's winrate over a sliding window
//     of the last N decided games) when identities are configured
//   - one line per matchup the user plays, so they can see where winrate is
//     trending by opponent race
//
// When identities are not configured, we fall back to a game-count cumulative
// chart instead (no "whose winrate" ambiguity).

import { useMemo } from 'react';
import type { AlignedData, Options, Series } from 'uplot';
import type { ReplayDigest } from '../analysis/aggregate';
import { useSettingsStore } from '../state/settings';
import { UPlotChart } from './UPlotChart';

const WINDOW = 10;   // number of most recent decided games to roll over
const RACE_VARS: Record<string, string> = {
  T: '--color-race-t',
  P: '--color-race-p',
  Z: '--color-race-z',
};
const RACE_FALLBACKS: Record<string, string> = {
  T: '#f97316',
  P: '#38bdf8',
  Z: '#a855f7',
};

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

interface OrderedDigest {
  digest: ReplayDigest;
  t: number;   // epoch ms; digests without startTime fall back to insertion order
}

export function TrendChart({ digests, hasIdentities }: { digests: ReplayDigest[]; hasIdentities: boolean }) {
  const theme = useSettingsStore((s) => s.theme);
  const ordered = useMemo<OrderedDigest[]>(() => {
    return [...digests]
      .map((d, i) => ({
        digest: d,
        t: d.startTime ? Date.parse(d.startTime) || i : i,
      }))
      .sort((a, b) => a.t - b.t);
  }, [digests]);

  const { data, options, empty } = useMemo(() => {
    if (ordered.length < 3) {
      return {
        data: null as AlignedData | null,
        options: null as Options | null,
        empty: true,
      };
    }

    // X axis: game index (1..N). Using dates looks nice but gets lumpy if
    // you import a back-catalog all at once; index is easier to read.
    const xs = ordered.map((_, i) => i + 1);

    if (hasIdentities) {
      // Overall rolling winrate + per-opponent-race rolling winrate.
      const overall = rollingWinrate(ordered, () => true, WINDOW);

      // Collect distinct opponent races present in me-games.
      const oppRaces = new Set<string>();
      for (const { digest } of ordered) {
        const mePlayers = digest.players.filter((p) => p.isMe);
        if (mePlayers.length === 0) continue;
        const opp = digest.players.find((p) => p.team !== mePlayers[0].team);
        if (opp) oppRaces.add(opp.race);
      }

      const perRace: Array<{ race: string; ys: (number | null)[] }> = [];
      for (const r of [...oppRaces].sort()) {
        perRace.push({
          race: r,
          ys: rollingWinrate(
            ordered,
            (d) => {
              const me = d.players.find((p) => p.isMe);
              if (!me) return false;
              const opp = d.players.find((p) => p.team !== me.team);
              return opp?.race === r;
            },
            WINDOW,
          ),
        });
      }

      const axisStroke = cssVar('--color-chart-axis', '#64748b');
      const accent = cssVar('--color-accent-2', '#eab308');
      const series: Series[] = [
        { label: 'Game' },
        { label: `Overall (${WINDOW}-game)`, stroke: accent, width: 2 },
        ...perRace.map((p) => ({
          label: `vs ${p.race}`,
          stroke: cssVar(RACE_VARS[p.race] ?? '', RACE_FALLBACKS[p.race] ?? '#94a3b8'),
          width: 1.5,
          dash: [4, 4],
        })),
      ];

      const data: AlignedData = [
        xs,
        overall,
        ...perRace.map((p) => p.ys),
      ] as unknown as AlignedData;

      const options: Options = {
        width: 600,
        height: 220,
        padding: [8, 8, 24, 40],
        series,
        scales: {
          x: { time: false },
          y: { range: [0, 100] },
        },
        axes: [
          {
            stroke: axisStroke,
            values: (_u, vals) => vals.map((v) => `#${v}`),
          },
          {
            stroke: axisStroke,
            values: (_u, vals) => vals.map((v) => `${v}%`),
          },
        ],
        legend: { show: true },
      };
      return { data, options, empty: false };
    }

    // No identity: show cumulative game count by matchup as a stacked
    // informational chart (no winrate since "whose winrate" is ambiguous).
    const matchups = [...new Set(ordered.map((o) => o.digest.matchup))].sort();
    const counts: number[][] = matchups.map(() => []);
    const running: Record<string, number> = Object.fromEntries(matchups.map((m) => [m, 0]));
    for (const { digest } of ordered) {
      running[digest.matchup] = (running[digest.matchup] ?? 0) + 1;
      matchups.forEach((m, i) => counts[i].push(running[m]));
    }
    const axisStroke = cssVar('--color-chart-axis', '#64748b');
    const series: Series[] = [
      { label: 'Game' },
      ...matchups.map((m, i) => ({
        label: m,
        stroke: paletteColor(i),
        width: 1.5,
      })),
    ];
    const data: AlignedData = [xs, ...counts] as unknown as AlignedData;
    const options: Options = {
      width: 600,
      height: 220,
      padding: [8, 8, 24, 40],
      series,
      scales: { x: { time: false } },
      axes: [{ stroke: axisStroke }, { stroke: axisStroke }],
      legend: { show: true },
    };
    return { data, options, empty: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered, hasIdentities, theme]);

  return (
    <div className="theme-panel rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3">
      <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        <span>
          {hasIdentities
            ? `Winrate trend (${WINDOW}-game rolling)`
            : 'Cumulative games by matchup'}
        </span>
        <span className="text-[10px] normal-case text-[var(--color-muted)]">
          {ordered.length} games · ordered by date
        </span>
      </div>
      {empty ? (
        <div className="py-10 text-center text-[11px] text-[var(--color-muted)]">
          Need at least 3 games in the filtered set to show a trend.
        </div>
      ) : (
        data && options && <UPlotChart key={theme} data={data} options={options} className="h-[220px]" />
      )}
      {hasIdentities && !empty && (
        <div className="mt-1 text-[10px] text-[var(--color-muted)]">
          Y is your rolling winrate (%) over the last {WINDOW} decided games; dashed lines split by opponent race.
        </div>
      )}
    </div>
  );
}

function rollingWinrate(
  ordered: OrderedDigest[],
  predicate: (d: ReplayDigest) => boolean,
  window: number,
): (number | null)[] {
  // For each game index we emit the winrate over the last `window` decided
  // games that match the predicate. Games that don't match (or are undecided)
  // carry the previous y forward so the line stays horizontal rather than
  // dropping to null on skipped rows.
  const ys: (number | null)[] = [];
  const matching: number[] = [];

  ordered.forEach((o, i) => {
    const d = o.digest;
    const me = d.players.find((p) => p.isMe);
    if (!me || !predicate(d) || me.won == null) {
      ys.push(ys[ys.length - 1] ?? null);
      return;
    }
    matching.push(i);
    const recent = matching.slice(-window);
    const w = recent.filter((j) => ordered[j].digest.players.find((p) => p.isMe)?.won === true).length;
    ys.push(Math.round((w / recent.length) * 100));
  });
  return ys;
}

function paletteColor(i: number): string {
  const palette = ['#38bdf8', '#f97316', '#a855f7', '#eab308', '#10b981', '#f472b6', '#fb7185'];
  return palette[i % palette.length];
}
