import { SignOutButton } from "@/components/app/sign-out-button";

export type AccountData = {
  email: string;
  plan: "trial" | "standard" | "max" | null;
  /** ISO date the trial or current period ends. */
  periodEnd: string | null;
  balance: number;
  repliesLeft: number;
  usedToday: number;
  dailyCap: number;
  /** True when periodEnd is in the past (computed on the server). */
  ended: boolean;
};

const PLAN_NAMES = {
  trial: "Trial",
  standard: "Standard",
  max: "Max",
} as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-3 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm text-foreground tabular-nums">
        {children}
      </dd>
    </div>
  );
}

export function AccountSection({ account }: { account: AccountData }) {
  const { plan, periodEnd } = account;
  const { ended } = account;
  let planText = "No plan";
  if (plan) {
    planText = PLAN_NAMES[plan];
    if (periodEnd) {
      const date = formatDate(periodEnd);
      planText +=
        plan === "trial"
          ? ended
            ? `, ended ${date}`
            : `, ends ${date}`
          : `, renews ${date}`;
    }
  }
  return (
    <section
      aria-labelledby="account-heading"
      className="border-t border-border py-6"
    >
      <h2
        id="account-heading"
        className="text-base font-semibold text-foreground"
      >
        Account
      </h2>
      <dl className="mt-3 max-w-md">
        <Row label="Email">{account.email}</Row>
        <Row label="Plan">{planText}</Row>
        <Row label="Credits">{account.balance.toLocaleString("en-US")}</Row>
        <Row label="Replies left">About {account.repliesLeft}</Row>
        <Row label="Used today">
          {account.usedToday.toLocaleString("en-US")} of{" "}
          {account.dailyCap.toLocaleString("en-US")} credits
        </Row>
      </dl>
      <div className="mt-4 -ml-2.5">
        <SignOutButton />
      </div>
    </section>
  );
}
