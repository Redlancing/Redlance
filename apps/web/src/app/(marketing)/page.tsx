import { Alerts } from "@/components/marketing/alerts";
import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { NicheTabs } from "@/components/marketing/niche-tabs";
import { Pricing } from "@/components/marketing/pricing";
import { PromiseQuote } from "@/components/marketing/promise-quote";
import { SubredditWall } from "@/components/marketing/subreddit-wall";
import { TimeBack } from "@/components/marketing/time-back";
import { VoiceShowcase } from "@/components/marketing/voice-showcase";

export default function HomePage() {
  return (
    <>
      <Hero />
      <SubredditWall />
      <HowItWorks />
      {/* The dark block sits above the quote, which is pulled up beneath it
          and revealed as the block scrolls away. */}
      <div className="relative z-10">
        <VoiceShowcase />
        <Alerts />
      </div>
      <PromiseQuote />
      <TimeBack />
      <NicheTabs />
      <Pricing />
      <Faq />
      <FinalCta />
    </>
  );
}
