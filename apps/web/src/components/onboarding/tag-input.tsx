"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { addTag } from "./tag-logic";

export function TagInput({
  id,
  values,
  onChange,
  max,
  maxLength,
  placeholder,
  invalid,
  describedBy,
}: {
  id: string;
  values: string[];
  onChange: (values: string[]) => void;
  max: number;
  maxLength: number;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [text, setText] = useState("");

  function commit() {
    const result = addTag(values, text, { max, maxLength });
    if (result.added) onChange(result.values);
    // Keep the text when it was refused, so the user can see and fix it.
    if (result.added || !text.trim()) setText("");
  }

  return (
    <div className="space-y-2">
      <Input
        id={id}
        value={text}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        disabled={values.length >= max}
        onChange={(e) => {
          const value = e.target.value;
          if (value.includes(",")) {
            const [word, ...rest] = value.split(",");
            const result = addTag(values, word, { max, maxLength });
            if (result.added) onChange(result.values);
            setText(rest.join(","));
          } else setText(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (
            e.key === "Backspace" &&
            text === "" &&
            values.length > 0
          ) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={commit}
        className="h-11 text-base md:text-sm"
      />
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {values.map((word) => (
            <li
              key={word}
              className="flex items-center gap-1 rounded-full border border-border bg-bone py-1 pr-1 pl-3 text-sm"
            >
              {word}
              <button
                type="button"
                aria-label={`Remove ${word}`}
                onClick={() => onChange(values.filter((w) => w !== word))}
                className="rounded-full p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
