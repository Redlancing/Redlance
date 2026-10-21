type Props = { newToday: number; sentThisWeek: number; won: number };

export function NumbersStrip({ newToday, sentThisWeek, won }: Props) {
  const items = [
    { label: "New today", value: newToday },
    { label: "Replies this week", value: sentThisWeek },
    { label: "Gigs won", value: won },
  ];
  return (
    <section aria-label="Your numbers" className="mt-6">
      <dl className="grid grid-cols-3 sm:divide-x sm:divide-border">
        {items.map(({ label, value }) => (
          <div
            key={label}
            className="flex flex-col-reverse gap-1 sm:px-6 sm:first:pl-0"
          >
            <dt className="text-xs text-stone sm:text-sm">{label}</dt>
            <dd className="text-2xl font-semibold tracking-tight text-foreground tabular-nums sm:text-4xl">
              {value.toLocaleString("en-US")}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
