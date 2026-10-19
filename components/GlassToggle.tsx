'use client';

// Liquid-glass on/off switch with a label and a one-line explanation.
type Props = { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string };

export default function GlassToggle({ checked, onChange, label, hint }: Props) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white/50 px-3 py-2.5 text-left">
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-[11px] leading-snug text-ink/50">{hint}</span>}
      </span>
      <span className={'glass relative h-8 w-14 shrink-0 rounded-full p-0.5 transition-colors duration-300 ' + (checked ? 'bg-accent/70' : '')}>
        <span className={'keep-white block h-7 w-7 rounded-full bg-white shadow-lift transition-transform duration-300 ' + (checked ? 'translate-x-6' : 'translate-x-0')} />
      </span>
    </button>
  );
}
