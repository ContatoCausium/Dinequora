import * as React from "react";
import { CalendarDays } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Design-system date field (redesign phase 2) replacing `<input type="date">`. Same contract as the
 * native input: the value is a calendar day `YYYY-MM-DD` (no time, no time zone) and `onChange`
 * receives `{ target: { value } }`, so forms keep their state and validation. Days are built and read
 * with local getters only, so a picked day never shifts across time zones.
 */
export type DateFieldChange = { target: { value: string } };

const toDate = (ymd: string): Date | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
};
const toYmd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface DateFieldProps {
  value: string;
  onChange: (event: DateFieldChange) => void;
  id?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

export function DateField({
  value,
  onChange,
  id,
  className,
  required,
  disabled,
  placeholder,
  ...aria
}: DateFieldProps) {
  const { i18n } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const selected = toDate(value);
  const label = selected
    ? new Intl.DateTimeFormat(i18n.language || "en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(selected)
    : (placeholder ?? "");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-required={required || undefined}
          aria-describedby={aria["aria-describedby"]}
          aria-invalid={aria["aria-invalid"]}
          data-value={value}
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm shadow-xs transition-[border-color,box-shadow] focus-visible:focus-field disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-[invalid=true]:border-destructive data-[state=open]:focus-field",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="tabular flex-1 truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <Calendar
          mode="single"
          {...(selected ? { selected, defaultMonth: selected } : {})}
          onSelect={(d) => {
            if (!d) return;
            onChange({ target: { value: toYmd(d) } });
            setOpen(false);
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
