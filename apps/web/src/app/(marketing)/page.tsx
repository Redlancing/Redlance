import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { SubredditWall } from "@/components/marketing/subreddit-wall";

export default function HomePage() {
  return (
    <>
      <Hero />
      <SubredditWall />
      <HowItWorks />
    </>
  );
}
