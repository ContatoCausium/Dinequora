import * as React from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Design-system replacement for the native `<select>` (redesign phase 2). It takes the SAME props and
 * the same `<option>` children as the native element and calls `onChange` with the same
 * `{ target: { value } }` shape, so screens migrate by swapping the tag — their state, validation and
 * submit logic stay untouched. Renders the Radix Select of the kit (keyboard, typeahead, ARIA listbox).
 *
 * Radix reserves the empty string, so `value=""` (typically "choose…" / "all") is mapped to an
 * internal sentinel and back. Only layout classes (width, flex, margin) of a call site's `className`
 * are kept: the look comes from the design system.
 */
const EMPTY = "__empty__";

type Option = { value: string; label: React.ReactNode; disabled: boolean };

function collectOptions(children: React.ReactNode, out: Option[] = []): Option[] {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as {
      value?: string | number;
      children?: React.ReactNode;
      disabled?: boolean;
    };
    if (child.type === "option")
      out.push({
        value: props.value === undefined ? String(props.children ?? "") : String(props.value),
        label: props.children,
        disabled: Boolean(props.disabled),
      });
    else if (props.children !== undefined) collectOptions(props.children, out);
  });
  return out;
}

const LAYOUT =
  /^(?:[a-z0-9-]+:)*(?:-?m[trblxy]?-|w-|min-w-|max-w-|flex-|grow|shrink|basis-|col-|row-|order-|self-|justify-self-|place-self-)/;
const layoutOnly = (className?: string) =>
  className
    ?.split(/\s+/)
    .filter((c) => LAYOUT.test(c))
    .join(" ");

export type FormSelectChange = { target: { value: string } };

export interface FormSelectProps {
  value: string;
  onChange: (event: FormSelectChange) => void;
  children: React.ReactNode;
  id?: string;
  name?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  size?: "sm" | "default";
  "aria-label"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
}

export function FormSelect({
  value,
  onChange,
  children,
  id,
  name,
  className,
  disabled,
  required,
  placeholder,
  size = "default",
  ...aria
}: FormSelectProps) {
  const options = collectOptions(children);
  const toInternal = (v: string) => (v === "" ? EMPTY : v);
  const selected = options.find((o) => o.value === value);
  // A disabled empty option is the native "Choose…" prompt: show it as the placeholder.
  const prompt = options.find((o) => o.value === "" && o.disabled);
  return (
    <Select
      value={selected && !(prompt && value === "") ? toInternal(value) : undefined}
      onValueChange={(v) => onChange({ target: { value: v === EMPTY ? "" : v } })}
      disabled={disabled}
      required={required}
      name={name}
    >
      <SelectTrigger
        id={id}
        className={cn(
          // Like the native element: as wide as its content unless the call site sets a width.
          !/(?:^|s)(?:[a-z0-9-]+:)*(?:w-|flex-|basis-|grow)/.test(layoutOnly(className) ?? "") &&
            "w-auto min-w-36 gap-3",
          size === "sm" && "h-8 text-[13px]",
          layoutOnly(className),
        )}
        aria-label={aria["aria-label"]}
        aria-invalid={aria["aria-invalid"]}
        aria-describedby={aria["aria-describedby"]}
      >
        <SelectValue placeholder={placeholder ?? prompt?.label} />
      </SelectTrigger>
      <SelectContent>
        {options
          .filter((o) => !(o === prompt))
          .map((o) => (
            <SelectItem key={o.value || EMPTY} value={toInternal(o.value)} disabled={o.disabled}>
              {o.label}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}
