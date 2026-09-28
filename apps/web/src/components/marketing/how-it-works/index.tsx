import {
  BubblesIllustration,
  FilterIllustration,
  FollowUpNudge,
  InsightsChart,
  LockedToggle,
  PortfolioPick,
  Radar,
  RulesIllustration,
  Stopwatch,
} from "../illustrations";
import { InView } from "../motion/in-view";
import { Pipeline } from "../pipeline";
import { Frame, SectionChip, TwoToneHeading } from "../primitives";
import {
  DraftMock,
  FindMock,
  FlagChips,
  MatchMock,
  SendMock,
  TrackMock,
} from "./mocks";
import { BudgetRanges, InsightsMock, PeakHours } from "./insights";
import { StepNav } from "./step-nav";

type Step = {
  id: string;
  label: string;
  lead: string;
  rest: string;
  mock: React.ReactNode;
  cards: {
    title: string;
    body: string;
    visual?: React.ReactNode;
    pro?: boolean;
  }[];
};

const steps: Step[] = [
  {
    id: "find",
    label: "Find",
    lead: "Every hiring post, one feed.",
    rest: "Tell us what you do and Redlance connects you to the subreddits where that work gets posted, then checks them every few minutes.",
    mock: <FindMock />,
    cards: [
      {
        title: "Connected on day one",
        body: "No hunting for the right subreddits. We connect you to them when you sign up, and you can add any others whenever you like.",
        visual: <Radar />,
      },
      {
        title: "No [For Hire] noise",
        body: "Other freelancers advertising themselves are skipped. Your feed is only clients who want to pay someone.",
        visual: <FilterIllustration />,
      },
    ],
  },
  {
    id: "match",
    label: "Match",
    lead: "Know what's worth your time.",
    rest: "Every post gets a 0 to 100 score against your skills and one line on why, so you only open the ones that can pay.",
    mock: <MatchMock />,
    cards: [
      {
        title: "Red flags, flagged",
        body: "Unpaid, equity-only and free-test-task posts are marked before you waste a reply on them.",
        visual: <FlagChips />,
      },
      {
        title: "Your rules",
        body: "Set a minimum budget or skip work you don't take, and those posts never reach you.",
        visual: <RulesIllustration />,
      },
    ],
  },
  {
    id: "draft",
    label: "Draft",
    lead: "Sounds like you, not a bot.",
    rest: "A comment for the thread and a first DM for their inbox, both about the client's actual problem, with your one best portfolio link.",
    mock: <DraftMock />,
    cards: [
      {
        title: "A comment and a first DM",
        body: "Both are ready the moment you open the post. Edit either one, then send it.",
        visual: <BubblesIllustration />,
      },
      {
        title: "One link, the right one",
        body: "Redlance picks the portfolio piece closest to the job, instead of pasting everything you've ever made.",
        visual: <PortfolioPick />,
      },
    ],
  },
  {
    id: "send",
    label: "You send",
    lead: "You always press send.",
    rest: "Redlance never posts from your account. Copy, open the post, send. Your account and your name stay yours.",
    mock: <SendMock />,
    cards: [
      {
        title: "Your account stays yours",
        body: "No auto-posting and no bulk messages, so your Reddit account is never put at risk.",
        visual: <LockedToggle />,
      },
      {
        title: "Two minutes, start to send",
        body: "From alert to reply in about the time it takes to read the post. On Reddit, the early replies get read.",
        visual: <Stopwatch />,
      },
    ],
  },
  {
    id: "track",
    label: "Track",
    lead: "No lead dies of silence.",
    rest: "Mark replies as sent, replied, hired or paid. If a reply sits with no update, Redlance nudges you with a follow-up ready to send.",
    mock: <TrackMock />,
    cards: [
      {
        title: "Follow-ups that write themselves",
        body: "Three days with no status on a reply? You get a reminder and a short follow-up draft.",
        visual: <FollowUpNudge />,
        pro: true,
      },
      {
        title: "Your hire rate",
        body: "See which kinds of gigs turn into paid work. It appears after about 20 replies, so it actually means something.",
        visual: <InsightsChart />,
      },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    lead: "Know where the money is.",
    rest: "See which subreddits post the most work for your skills, what their clients post as budgets, and when they post, so your evenings go where the hires are.",
    mock: <InsightsMock />,
    cards: [
      {
        title: "Be online when clients post",
        body: "Hiring posts bunch up in a few hours of the day. We show you which ones, in your time zone.",
        visual: <PeakHours />,
        pro: true,
      },
      {
        title: "Posted budgets, side by side",
        body: "Compare what each subreddit's clients actually offer before you decide where to spend your time.",
        visual: <BudgetRanges />,
        pro: true,
      },
    ],
  },
];

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-heading"
      className="border-b border-border bg-cream"
    >
      <Frame>
        <div className="flex items-center justify-between gap-12 px-4 py-20 sm:px-12 sm:py-28 lg:px-16">
          <div className="flex flex-col items-start gap-5">
            <SectionChip>How it works</SectionChip>
            <TwoToneHeading
              id="how-it-works-heading"
              lead="Your gig radar never sleeps."
              rest="It catches hiring posts at 2am, scores each one against your skills, and has a reply ready before you've opened Reddit."
              className="max-w-[40rem]"
            />
          </div>
          <InView className="hidden xl:block">
            <Pipeline />
          </InView>
        </div>

        <div className="border-t border-border lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
          <StepNav steps={steps.map(({ id, label }) => ({ id, label }))} />
          <div>
            {steps.map((step) => (
              <article
                key={step.id}
                id={step.id}
                aria-labelledby={`${step.id}-heading`}
                tabIndex={-1}
                className="scroll-mt-28 border-b border-border last:border-b-0 focus:outline-none lg:scroll-mt-16"
              >
                <div className="px-4 pt-14 pb-10 sm:px-12 sm:pt-20">
                  <TwoToneHeading
                    as="h3"
                    id={`${step.id}-heading`}
                    lead={step.lead}
                    rest={step.rest}
                    className="max-w-[34rem]"
                  />
                </div>
                <InView
                  amount={0.25}
                  className="border-y border-border bg-secondary px-3 py-10 sm:px-12 sm:py-14"
                >
                  {step.mock}
                </InView>
                <div className="grid sm:grid-cols-2">
                  {step.cards.map((card) => (
                    <div
                      key={card.title}
                      className="flex flex-col gap-2 border-border px-4 py-8 not-last:border-b sm:px-12 sm:not-last:border-r sm:not-last:border-b-0"
                    >
                      <p className="flex items-center gap-2 text-[17px] font-medium tracking-[-0.01em]">
                        {card.title}
                        {card.pro && (
                          <span className="rounded-md bg-ink px-1.5 py-px text-[11px] font-medium tracking-normal text-bone">
                            Pro
                          </span>
                        )}
                      </p>
                      <p className="max-w-[26rem] leading-relaxed text-muted-foreground">
                        {card.body}
                      </p>
                      {card.visual && (
                        <InView className="mt-6 flex min-h-40 items-center">
                          {card.visual}
                        </InView>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </Frame>
    </section>
  );
}
