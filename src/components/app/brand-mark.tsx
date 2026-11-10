import { cn } from "@/lib/utils";

export function OrgLogo({
  logoUrl,
  initials,
  className,
}: {
  logoUrl?: string | undefined;
  initials: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-card text-xs font-semibold text-primary",
        className,
      )}
    >
      {logoUrl ? <img src={logoUrl} alt="" className="size-full object-contain p-0.5" /> : initials}
    </span>
  );
}

export function DemoBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "demo-stripe inline-flex items-center gap-1.5 rounded-full border border-warning/40 px-2 py-0.5 text-[11px] font-medium text-foreground",
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-warning" aria-hidden />
      {label}
    </span>
  );
}

/** Dinequora brand icon (official artwork from website/public/brand/dinequora_icone_transparente.svg). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} role="img" aria-label="Dinequora">
      <path
        fill="#10B981"
        d="M24 14H97C145 14 176 48 176 95C176 144 145 176 96 176H48C56 164 66 153 78 147H96C128 147 146 128 146 96C146 64 128 44 96 44H66C45 44 32 33 24 14Z"
      />
      <path
        fill="#10B981"
        d="M36 48C45 58 56 64 66 69C75 74 79 83 79 94V111C62 122 48 142 36 163Z"
      />
      <path
        fill="#10B981"
        d="M39 178C49 141 66 122 90 112C107 105 124 103 137 99C128 122 113 132 94 137C72 143 55 155 43 178Z"
      />
    </svg>
  );
}

/** @deprecated Former name of {@link BrandMark}; kept so older imports keep working. */
export const ServoraMark = BrandMark;
