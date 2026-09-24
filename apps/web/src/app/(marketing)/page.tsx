import { Alerts } from "@/components/marketing/alerts";
import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { NicheTabs } from "@/components/marketing/niche-tabs";
import { Pricing } from "@/components/marketing/pricing";
import { SubredditWall } from "@/components/marketing/subreddit-wall";
import { VoiceShowcase } from "@/components/marketing/voice-showcase";

export default function HomePage() {
  return (
    <>
      <Hero />
      <SubredditWall />
      <HowItWorks />
      <VoiceShowcase />
      <Alerts />
      <NicheTabs />
      <Pricing />
      <Faq />
      <FinalCta />
    </>
  );
}
