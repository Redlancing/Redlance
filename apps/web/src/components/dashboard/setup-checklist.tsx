import { Check, Circle } from "lucide-react";
import Link from "next/link";
import type { ChecklistItem } from "./overview";

export function SetupChecklist({ items }: { items: ChecklistItem[] }) {
  return (
    <section aria-labelledby="checklist-heading" className="mt-8">
      <h2
        id="checklist-heading"
        className="text-base font-semibold text-foreground"
      >
        Get set up
      </h2>
      <ul className="mt-2 divide-y divide-border border-y border-border">
        {items.map((item) => (
          <li key={item.id}>
            {/* Dynamic pages without a loading state: a prefetch would get no data anyway. */}
            <Link
              href={item.href}
              prefetch={false}
              className={`flex items-center gap-3 py-3 text-sm hover:text-foreground ${
                item.done
                  ? "text-muted-foreground"
                  : "font-medium text-foreground"
              }`}
            >
              {item.done ? (
                <Check className="size-4 text-success" aria-hidden="true" />
              ) : (
                <Circle className="size-4 text-stone" aria-hidden="true" />
              )}
              <span>{item.label}</span>
              {item.done && <span className="sr-only">(done)</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
