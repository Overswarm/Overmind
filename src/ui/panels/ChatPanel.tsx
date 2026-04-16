import { useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { cleanBwString, formatMMSS, frameToSeconds } from '../../types/replay';
import { commandsOfType, cmdMessage, cmdSenderSlotID, TYPE_NAMES } from '../../analysis/commands';

export function ChatPanel() {
  const active = useAppStore((s) => s.active);
  const currentFrame = useAppStore((s) => s.currentFrame);

  const { messages, slotNames } = useMemo(() => {
    if (!active) return { messages: [], slotNames: new Map<number, string>() };
    const slotNames = new Map<number, string>();
    for (const p of active.replay.Header?.Players ?? []) {
      slotNames.set(p.SlotID, cleanBwString(p.Name));
    }
    const msgs = commandsOfType(active.replay, TYPE_NAMES.chat)
      .map((c) => ({
        frame: c.Frame,
        senderSlot: cmdSenderSlotID(c),
        text: cleanBwString(cmdMessage(c) ?? ''),
      }))
      .filter((m, i, all) => i === 0 || m.frame !== all[i - 1].frame || m.text !== all[i - 1].text);
    return { messages: msgs, slotNames };
  }, [active]);

  if (!active) return null;

  return (
    <div className="flex h-full flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]">
      <div className="border-b border-[var(--color-border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        Chat log
        {messages.length > 0 && (
          <span className="ml-2 text-[10px] font-normal normal-case text-[var(--color-muted)]">
            {messages.length} message{messages.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {messages.length === 0 ? (
          <div className="p-4 text-center text-sm text-[var(--color-muted)]">No chat in this replay.</div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {messages.map((m, i) => {
              const isPast = m.frame <= currentFrame;
              return (
                <li key={i} className={`px-3 py-2 text-xs ${isPast ? 'opacity-100' : 'opacity-50'}`}>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono tabular-nums text-[var(--color-muted)]">
                      {formatMMSS(frameToSeconds(m.frame))}
                    </span>
                    <span className="font-medium text-[var(--color-text-h)]">
                      {m.senderSlot !== undefined ? (slotNames.get(m.senderSlot) ?? `Slot ${m.senderSlot}`) : 'System'}
                    </span>
                  </div>
                  <div className="mt-0.5 whitespace-pre-wrap break-words">{m.text || '(empty)'}</div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
