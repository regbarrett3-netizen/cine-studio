import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export const FOCUS = 'focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-white';
export const BTN_PRIMARY = `w-full min-h-[64px] px-6 py-4 rounded-2xl font-bold text-lg bg-gradient-to-r from-purple-500 via-pink-500 to-red-500 text-white shadow-lg shadow-pink-500/25 ${FOCUS}`;
export const BTN_DISABLED = `w-full min-h-[64px] px-6 py-4 rounded-2xl font-bold text-lg bg-slate-800 text-slate-400 cursor-not-allowed ${FOCUS}`;
export const BTN_SECONDARY = `min-h-[48px] px-4 py-2 rounded-xl text-base font-semibold bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-100 ${FOCUS}`;

export interface ScreenProps {
  title: string;
  subtitle?: string;
  modeLabel: string;
  onBack: () => void;
  backLabel?: string;
  children: ReactNode;
}

export function Screen({ title, subtitle, modeLabel, onBack, backLabel = '← Back', children }: ScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-800">
        <button type="button" onClick={onBack} className={BTN_SECONDARY}>
          {backLabel}
        </button>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold truncate">
          ✓ {modeLabel}
        </div>
      </header>
      <main className="max-w-xl mx-auto px-4 py-6 space-y-6">
        <div className="space-y-2">
          <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-black leading-tight outline-none">
            {title}
          </h1>
          {subtitle ? <p className="text-slate-300 text-base leading-relaxed">{subtitle}</p> : null}
        </div>
        {children}
      </main>
    </div>
  );
}

export interface DonePanelProps {
  message: string;
  againLabel: string;
  onAgain: () => void;
  onHome: () => void;
}

export function DonePanel({ message, againLabel, onAgain, onHome }: DonePanelProps) {
  return (
    <div role="status" className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5 space-y-4">
      <p className="text-2xl font-black text-emerald-300">🎉 Added to your project!</p>
      <p className="text-slate-200 leading-relaxed">{message}</p>
      <div className="grid gap-3">
        <button type="button" onClick={onHome} className={BTN_PRIMARY}>
          Back to my project
        </button>
        <button type="button" onClick={onAgain} className={`${BTN_SECONDARY} min-h-[56px] text-lg`}>
          {againLabel}
        </button>
      </div>
    </div>
  );
}
