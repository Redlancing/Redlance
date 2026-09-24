import Link from "next/link";
import { CheckIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { plans, type Plan } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { Frame, SectionChip, TwoToneHeading } from "./primitives";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function PlanPrice({ plan }: { plan: Plan }) {
  if (!plan.available) {
    return <p className="text-2xl font-semibold tracking-tight">Later</p>;
  }
  if (plan.price === null) {
    return (
      <p className="text-2xl font-semibold tracking-tight">Price at launch</p>
    );
  }
  return (
    <p className="flex items-baseline gap-1">
      <span className="text-2xl font-semibold tracking-tight tabular-nums">
        {inr.format(plan.price)}
      </span>
      <span className="text-muted-foreground">a month</span>
    </p>
  );
}

export function Pricing() {
  return (
    <section
      id="pricing"
      aria-labelledby="pricing-heading"
      className="border-b border-border bg-cream"
    >
      <Frame>
        <div className="flex flex-col items-start gap-5 px-4 py-20 sm:px-12 sm:py-24 lg:px-16">
          <SectionChip>Pricing</SectionChip>
          <TwoToneHeading
            id="pricing-heading"
            lead="Start free. Upgrade when it pays."
            rest="Prices in rupees, paid with UPI or card."
            className="max-w-[40rem]"
          />
        </div>

        <ul className="grid border-t border-border md:grid-cols-3">
          {plans.map((plan) => (
            <li
              key={plan.name}
              className={cn(
                "flex flex-col gap-6 border-border px-4 py-10 not-last:border-b sm:px-12 md:not-last:border-r md:not-last:border-b-0 lg:px-10",
                plan.highlight && "bg-background",
              )}
            >
              <div className="flex flex-col gap-1.5">
                <h3 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.01em]">
                  {plan.name}
                  {!plan.available && (
                    <span className="rounded-md bg-flare-50 px-1.5 py-px text-xs font-medium text-flare-700">
                      Soon
                    </span>
                  )}
                </h3>
                <p className="text-muted-foreground">{plan.summary}</p>
              </div>
              <PlanPrice plan={plan} />
              <ul className="flex flex-col gap-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <CheckIcon
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              {plan.cta && (
                <Link
                  href={plan.cta.href}
                  className={buttonVariants({
                    variant: plan.highlight ? "default" : "outline",
                    size: "xl",
                    className: "mt-auto sm:h-10 sm:text-sm",
                  })}
                >
                  {plan.cta.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </Frame>
    </section>
  );
}
