export function LogoMark({ className = 'size-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="15" fill="#ffffff" />
      <path d="M32 11 L51 51 H41.5 L32 30.5 L22.5 51 H13 Z" fill="#0a1a3a" />
      <path d="M25.5 43 H38.5" stroke="#2563eb" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <div className="flex items-center gap-3">
      <LogoMark />
      <div className="leading-tight">
        <p className="text-[17px] font-bold tracking-[0.14em] text-white">ASCENDRA</p>
        <p className="text-[10.5px] font-medium tracking-[0.12em] text-navy-300 uppercase">Smart Traffic Intelligence</p>
      </div>
    </div>
  );
}
