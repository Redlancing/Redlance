import { Label } from "@/components/ui/label";

export const errorId = (id: string) => `${id}-error`;
export const hintId = (id: string) => `${id}-hint`;

/** aria props for a control: invalid state + described by its hint or error. */
export function controlProps(id: string, error?: string, hint?: string) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId(id) : hint ? hintId(id) : undefined,
  } as const;
}

export function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
      </Label>
      {children}
      {error ? (
        <p id={errorId(id)} className="text-sm text-danger">{error}</p>
      ) : hint ? (
        <p id={hintId(id)} className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** For groups (chips, radios): a fieldset with a legend instead of a label. */
export function FieldGroup({
  legend,
  hint,
  error,
  errorKey,
  children,
}: {
  legend: string;
  hint?: string;
  error?: string;
  errorKey: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-2" aria-describedby={error ? errorId(errorKey) : undefined}>
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
      {error && <p id={errorId(errorKey)} className="text-sm text-danger">{error}</p>}
    </fieldset>
  );
}
