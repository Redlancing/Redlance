import { Frame, SectionChip, TwoToneHeading } from "../primitives";
import {
  DraftMock,
  FindMock,
  FlagChips,
  MatchMock,
  SendMock,
  TrackMock,
} from "./mocks";
import { StepNav } from "./step-nav";

type Step = {
  id: string;
  label: string;
  lead: string;
  rest: string;
  mock: React.ReactNode;
  cards: { title: string; body: string; visual?: React.ReactNode }[];
};

const steps: Step[] = [
  {
    id: "find",
    label: "Find",
    lead: "Every hiring post, one feed.",
    rest: "We check the subreddits you pick every few minutes, so you can stop refreshing them all day.",
    mock: <FindMock />,
    cards: [
      {
        title: "No [For Hire] noise",
        body: "Other freelancers' ads are skipped. You only see clients who want to hire.",
      },
      {
        title: "Your subreddits, your niche",
        body: "Pick where to look, from r/forhire to niche boards for editors and designers.",
      },
    ],
  },
  {
    id: "match",
    label: "Match",
    lead: "Know what's worth your time.",
    rest: "Each post gets a score from 0 to 100 against your skills, with one line on why.",
    mock: <MatchMock />,
    cards: [
      {
        title: "Red flags, flagged",
        body: "Unpaid, equity-only and free-test-task posts are marked before you reply.",
        visual: <FlagChips />,
      },
      {
        title: "Your rules",
        body: "Set a minimum budget or skip certain kinds of work, and those posts stay out of your way.",
      },
    ],
  },
  {
    id: "draft",
    label: "Draft",
    lead: "Sounds like you, not a bot.",
    rest: "Short replies that mention the client's actual problem and link your one best portfolio piece.",
    mock: <DraftMock />,
    cards: [
      {
        title: "Comment and DM",
        body: "One version for the thread, one for their inbox. Edit either before you send.",
      },
      {
        title: "One link, the right one",
        body: "Redlance picks the portfolio piece closest to the job instead of pasting all of them.",
      },
    ],
  },
  {
    id: "send",
    label: "You send",
    lead: "You always press send.",
    rest: "Redlance never posts from your account. Copy the reply, open the post and send it yourself.",
    mock: <SendMock />,
    cards: [
      {
        title: "Your account stays yours",
        body: "No auto-posting and no bulk DMs, so your Reddit account isn't put at risk.",
      },
      {
        title: "Two minutes, start to send",
        body: "From alert to reply in about the time it takes to read the post.",
      },
    ],
  },
  {
    id: "track",
    label: "Track",
    lead: "See what gets you hired.",
    rest: "Mark each reply as sent, replied, hired or paid, and see which gigs are worth chasing.",
    mock: <TrackMock />,
    cards: [
      {
        title: "Follow-up reminders",
        body: "Coming soon: a nudge when a client goes quiet after your reply.",
      },
      {
        title: "Insights once there's enough data",
        body: "Patterns show up after about 20 replies, not before, so they mean something.",
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
        <div className="flex flex-col items-start gap-5 px-4 py-20 sm:px-12 sm:py-28 lg:px-16">
          <SectionChip>How it works</SectionChip>
          <TwoToneHeading
            id="how-it-works-heading"
            lead="Your gig radar never sleeps."
            rest="It catches hiring posts at 2am, scores each one against your skills, and has a reply ready before you've opened Reddit."
            className="max-w-[48rem]"
          />
        </div>

        <div className="border-t border-border lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
          <StepNav steps={steps.map(({ id, label }) => ({ id, label }))} />
          <div>
            {steps.map((step) => (
              <article
                key={step.id}
                id={step.id}
                aria-labelledby={`${step.id}-heading`}
                className="scroll-mt-12 border-b border-border last:border-b-0 lg:scroll-mt-0"
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
                <div className="border-y border-border bg-secondary px-3 py-10 sm:px-12 sm:py-14">
                  {step.mock}
                </div>
                <div className="grid sm:grid-cols-2">
                  {step.cards.map((card) => (
                    <div
                      key={card.title}
                      className="flex flex-col gap-2 border-border px-4 py-8 not-last:border-b sm:px-12 sm:not-last:border-r sm:not-last:border-b-0"
                    >
                      <p className="text-[17px] font-medium tracking-[-0.01em]">
                        {card.title}
                      </p>
                      <p className="max-w-[26rem] leading-relaxed text-muted-foreground">
                        {card.body}
                      </p>
                      {card.visual && <div className="mt-2">{card.visual}</div>}
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
