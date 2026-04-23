// Library-wide achievements tab. Loads every replay with a cached parse,
// digests it, and evaluates the achievement list from analysis/achievements.
// Achievements are grouped into sections by race / skill / library so the
// long flat list reads as a scrapbook rather than a todo.

import { useEffect, useMemo, useState } from 'react';
import { getCachedReplay, listLibrary, type LibraryEntry } from '../storage/db';
import { digestReplay, type ReplayDigest } from '../analysis/aggregate';
import {
  computeAchievements,
  type Achievement,
  type AchievementCategory,
  type AchievementsResult,
} from '../analysis/achievements';
import { useSettingsStore } from '../state/settings';

const CATEGORY_ORDER: AchievementCategory[] = [
  'terran',
  'protoss',
  'zerg',
  'skill',
  'wins',
  'records',
  'library',
];

const CATEGORY_LABEL: Record<AchievementCategory, string> = {
  terran: 'Terran',
  protoss: 'Protoss',
  zerg: 'Zerg',
  skill: 'Skill',
  wins: 'Wins',
  records: 'Records',
  library: 'Library',
};

const CATEGORY_BLURB: Record<AchievementCategory, string> = {
  terran: 'Earn these by training Terran units in your games.',
  protoss: 'Earn these by training Protoss units in your games.',
  zerg: 'Earn these by morphing Zerg units in your games.',
  skill: 'APM and EAPM milestones.',
  wins: 'Rack up wins per race.',
  records: 'Single-game records and cross-race variety.',
  library: 'Tied to your replay library, not your gameplay.',
};

export function AchievementsView() {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [digests, setDigests] = useState<ReplayDigest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLocked, setShowLocked] = useState(true);
  const identities = useSettingsStore((s) => s.identities);
  const addIdentity = useSettingsStore((s) => s.addIdentity);
  const removeIdentity = useSettingsStore((s) => s.removeIdentity);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const lib = await listLibrary();
      if (cancelled) return;
      setEntries(lib);
      const out: ReplayDigest[] = [];
      for (const e of lib) {
        try {
          const parsed = await getCachedReplay(e.hash);
          if (!parsed) continue;
          out.push(digestReplay(e, parsed, identities));
        } catch (err) {
          console.warn('[achievements] failed to digest', e.hash, err);
        }
      }
      if (cancelled) return;
      setDigests(out);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [identities]);

  const result: AchievementsResult = useMemo(
    () => computeAchievements(digests, entries),
    [digests, entries],
  );

  const grouped = useMemo(() => {
    const g = new Map<AchievementCategory, Achievement[]>();
    for (const a of result.achievements) {
      if (!g.has(a.category)) g.set(a.category, []);
      g.get(a.category)!.push(a);
    }
    // Preserve the declaration order within each category.
    return g;
  }, [result.achievements]);

  const needsIdentity = result.needsIdentity || identities.length === 0;

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4 text-sm text-[var(--color-text-h)]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-lg font-semibold">Achievements</div>
        <div className="text-xs text-[var(--color-muted)]">
          {loading
            ? 'Loading…'
            : result.totalCount === 0
              ? needsIdentity
                ? 'Set your name below to start earning achievements.'
                : 'No games to evaluate yet.'
              : `${result.unlockedCount} / ${result.totalCount} unlocked · ${result.meGames} of your games`}
        </div>
        {result.totalCount > 0 && (
          <label className="ml-auto flex items-center gap-2 text-[11px] text-[var(--color-muted)]">
            <input
              type="checkbox"
              checked={showLocked}
              onChange={(e) => setShowLocked(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            Show locked
          </label>
        )}
      </div>

      <IdentityBar identities={identities} onAdd={addIdentity} onRemove={removeIdentity} />

      {needsIdentity && (
        <div className="theme-panel rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-4 text-xs text-[var(--color-muted)]">
          Add your in-game name above to unlock per-race and per-game
          achievements. Library achievements (10 replays, annotated games)
          count regardless.
        </div>
      )}

      {result.totalCount > 0 && (
        <ProgressBar unlocked={result.unlockedCount} total={result.totalCount} />
      )}

      {CATEGORY_ORDER.map((cat) => {
        const list = grouped.get(cat) ?? [];
        if (list.length === 0) return null;
        const visible = showLocked ? list : list.filter((a) => a.unlocked);
        if (visible.length === 0) return null;
        const unlocked = list.filter((a) => a.unlocked).length;
        return (
          <Section
            key={cat}
            title={CATEGORY_LABEL[cat]}
            blurb={CATEGORY_BLURB[cat]}
            unlocked={unlocked}
            total={list.length}
            achievements={visible}
          />
        );
      })}
    </div>
  );
}

function Section({
  title,
  blurb,
  unlocked,
  total,
  achievements,
}: {
  title: string;
  blurb: string;
  unlocked: number;
  total: number;
  achievements: Achievement[];
}) {
  return (
    <div className="theme-panel rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]">
      <div className="flex items-baseline justify-between border-b border-[var(--color-border)] px-3 py-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            {title}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--color-muted)]">{blurb}</div>
        </div>
        <div className="font-mono text-[11px] tabular-nums text-[var(--color-muted)]">
          {unlocked} / {total}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 p-3 md:grid-cols-2 lg:grid-cols-3">
        {achievements.map((a) => (
          <AchievementCard key={a.id} achievement={a} />
        ))}
      </div>
    </div>
  );
}

function AchievementCard({ achievement }: { achievement: Achievement }) {
  const { unlocked, progress } = achievement;
  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        unlocked
          ? 'border-[var(--color-accent)]/60 bg-[color-mix(in_oklab,var(--color-accent)_10%,var(--color-bg))]'
          : 'border-[var(--color-border)] bg-[var(--color-bg)] opacity-70'
      }`}
      title={achievement.description}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={`truncate text-sm font-semibold ${
            unlocked ? 'text-[var(--color-text-h)]' : 'text-[var(--color-muted)]'
          }`}
        >
          {achievement.title}
        </span>
        <span
          className={`shrink-0 rounded px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide ${
            unlocked
              ? 'bg-[var(--color-accent)] text-white'
              : 'border border-[var(--color-border)] text-[var(--color-muted)]'
          }`}
        >
          {unlocked ? '✓' : 'locked'}
        </span>
      </div>
      <div className="mt-1 text-[11px] leading-snug text-[var(--color-muted)]">
        {achievement.description}
      </div>
      {progress && !unlocked && (
        <ProgressRow current={progress.current} target={progress.target} id={achievement.id} />
      )}
      {unlocked && achievement.gameMap && (
        <div className="mt-2 truncate text-[10px] text-[var(--color-muted)]" title={achievement.gameMap}>
          First earned on{' '}
          <span className="font-mono text-[var(--color-text-h)]">{achievement.gameMap}</span>
        </div>
      )}
    </div>
  );
}

function ProgressRow({ current, target, id }: { current: number; target: number; id: string }) {
  const pct = Math.round((current / target) * 100);
  // Time-based achievements (library hours) render as H:MM so 10-hour targets
  // are readable; everything else as integer counters.
  const isTime = id.endsWith('hr');
  const render = (n: number) => {
    if (!isTime) return `${n}`;
    const hours = Math.floor(n / 3600);
    const minutes = Math.floor((n % 3600) / 60);
    return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  };
  return (
    <div className="mt-2">
      <div className="h-1.5 w-full overflow-hidden rounded bg-[var(--color-bg-elev)]">
        <div
          className="h-full bg-[var(--color-accent)]"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-[var(--color-muted)]">
        <span>{render(current)}</span>
        <span>{render(target)}</span>
      </div>
    </div>
  );
}

function ProgressBar({ unlocked, total }: { unlocked: number; total: number }) {
  const pct = total > 0 ? Math.round((unlocked / total) * 100) : 0;
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3">
      <div className="mb-2 flex items-baseline justify-between text-xs">
        <span className="font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Overall
        </span>
        <span className="font-mono tabular-nums text-[var(--color-text-h)]">
          {unlocked} / {total} ({pct}%)
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-[var(--color-bg-elev)]">
        <div
          className="h-full bg-[var(--color-accent)]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function IdentityBar({
  identities,
  onAdd,
  onRemove,
}: {
  identities: string[];
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  const [value, setValue] = useState('');
  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onAdd(v);
    setValue('');
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span
        className="w-16 text-[var(--color-muted)]"
        title="Names you play under — achievements count games where one of these matches the in-game name."
      >
        Me tags
      </span>
      {identities.map((name) => (
        <span
          key={name}
          className="flex items-center gap-1 rounded bg-[color-mix(in_oklab,var(--color-accent)_22%,transparent)] px-2 py-0.5 text-[var(--color-text-h)]"
        >
          {name}
          <button
            onClick={() => onRemove(name)}
            className="text-[var(--color-muted)] hover:text-[var(--color-text-h)]"
            aria-label={`Remove ${name}`}
            title="Remove"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder={identities.length === 0 ? 'Add your BW name (press Enter)…' : 'Add another…'}
        className="w-48 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-0.5 text-xs text-[var(--color-text-h)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
      />
      {value.trim() && (
        <button
          onClick={submit}
          className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)] hover:text-[var(--color-text-h)]"
        >
          Add
        </button>
      )}
    </div>
  );
}
