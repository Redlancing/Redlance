"use client";

import { cn } from "cn";
import { FileText, Upload, X } from "lucide-react";
import { useState } from "react";

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const ACCEPT = ".pdf,.docx";

/** The client check (the server checks again by magic bytes). Returns an error or null. */
export function checkResumeFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!name.endsWith(".pdf") && !name.endsWith(".docx"))
    return "Upload a PDF or Word (.docx) file.";
  if (file.size > MAX_RESUME_BYTES) return "That file is over 5 MB.";
  if (file.size === 0) return "That file is empty.";
  return null;
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A <label> around a visually hidden file input, so click, keyboard and drop all work. */
export function ResumeDrop({
  file,
  onFile,
  disabled,
}: {
  file: File | null;
  onFile: (file: File | null) => void;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function choose(picked: File | undefined) {
    if (!picked) return;
    const problem = checkResumeFile(picked);
    setError(problem);
    onFile(problem ? null : picked);
  }

  return (
    <div className="space-y-1.5">
      <label
        htmlFor="resume"
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) choose(e.dataTransfer.files[0]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed border-feed bg-bone/60 p-6 text-center text-sm transition-colors has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
          dragging && "border-flare-500 bg-flare-50",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <input
          id="resume"
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "resume-error" : "resume-hint"}
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = ""; // choosing the same file again still fires
          }}
        />
        <Upload className="size-5 text-stone" aria-hidden="true" />
        <span className="font-medium text-foreground">
          Drop your resume here, or{" "}
          <span className="underline underline-offset-2">choose a file</span>
        </span>
        <span id="resume-hint" className="text-xs text-muted-foreground">
          PDF or Word (.docx), up to 5 MB. We read it once and don&apos;t keep
          the file.
        </span>
      </label>
      {file && (
        <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
          <FileText className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{file.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatSize(file.size)}
          </span>
          <button
            type="button"
            className="ml-auto rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
            onClick={() => onFile(null)}
            disabled={disabled}
            aria-label={`Remove ${file.name}`}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
      {error && (
        <p id="resume-error" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
