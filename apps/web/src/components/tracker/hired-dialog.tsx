"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildPatchBody, type PatchBody } from "./tracker-state";

export function HiredDialog({
  open,
  title,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm: (body: PatchBody) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        {/* Mounted only while open, so the fields start empty each time. */}
        {open && (
          <HiredForm title={title} onClose={onClose} onConfirm={onConfirm} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function HiredForm({
  title,
  onClose,
  onConfirm,
}: {
  title: string;
  onClose: () => void;
  onConfirm: (body: PatchBody) => void;
}) {
  const [rate, setRate] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [unpaid, setUnpaid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = buildPatchBody("hired", { rate, currency, unpaid });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onConfirm(result.body);
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Nice, you got the gig</DialogTitle>
        <DialogDescription>
          {title}. The rate is optional and helps you see what you really earn.
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-[1fr_5.5rem] gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="hired-rate">Agreed rate</Label>
          <Input
            id="hired-rate"
            inputMode="decimal"
            autoComplete="off"
            placeholder="450"
            value={rate}
            disabled={unpaid}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "hired-error" : undefined}
            onChange={(e) => {
              setRate(e.target.value);
              setError(null);
            }}
            className="tabular-nums"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="hired-currency">Currency</Label>
          <Input
            id="hired-currency"
            maxLength={3}
            autoComplete="off"
            value={currency}
            disabled={unpaid}
            onChange={(e) => {
              setCurrency(e.target.value.toUpperCase());
              setError(null);
            }}
            className="uppercase"
          />
        </div>
      </div>
      <Label htmlFor="hired-unpaid" className="gap-2 font-normal">
        <input
          id="hired-unpaid"
          type="checkbox"
          checked={unpaid}
          onChange={(e) => {
            setUnpaid(e.target.checked);
            setError(null);
          }}
          className="size-4 rounded-sm border-input accent-ink focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        This turned out unpaid
      </Label>
      {error && (
        <p id="hired-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Mark as hired</Button>
      </DialogFooter>
    </form>
  );
}
