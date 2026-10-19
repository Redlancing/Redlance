import type { CategoryId } from "../taxonomy";
import type { ReplyKind } from "./types";

/**
 * The hand-written example library (docs/drafts/README.md §12). Synced into `draft_examples` by
 * `syncReferenceData()`; the prompt shows 1 comment + up to 2 DMs for the post's job type, topped
 * up from `general`. Fictional people and businesses. Every number in `text` is in `facts` or
 * `postExcerpt`, so each example passes `validateDraft` against its own evidence. None of these
 * may be reused as an eval case (Phase 10 checks).
 *
 * Editing rule: a changed text changes the cached prompt prefix for that job type, so edit in
 * batches and bump `DRAFT_PROMPT_VERSION` (apps/worker/src/drafts/prompt.ts) when you do.
 */

/** Stands for the user's one link in an example; the prompt says so. */
export const LINK_PLACEHOLDER = "{link}";

export type DraftExampleStyle =
  | "proof_first"
  | "problem_first"
  | "question_first"
  | "dm_only"
  | "code_word"
  | "rate_asked"
  | "broad";

export type DraftExample = {
  id: string;
  jobType: CategoryId | "general";
  channel: ReplyKind;
  style: DraftExampleStyle;
  /** The post the example answers (shown to the model with the example). */
  postExcerpt: string;
  text: string;
  /** The made-up evidence the example was written from. Test-only: not synced, never prompted. */
  facts: string;
};

export const DRAFT_EXAMPLES: readonly DraftExample[] = [
  // ---- development -------------------------------------------------------------------------
  {
    id: "dev-comment-shopify",
    jobType: "development",
    channel: "comment",
    style: "proof_first",
    postExcerpt:
      "[Hiring] Shopify store checkout keeps timing out on mobile. Need someone to find out why and fix it. Budget $300.",
    text: "Mobile checkout timeouts on Shopify are often an app script blocking the page. I tracked down the same problem on a candle store's checkout, sent you a DM.",
    facts:
      "Project: Speed fix for a candle store on Shopify. Outcome: mobile checkout stopped timing out after removing a blocking app script.",
  },
  {
    id: "dev-dm-booking",
    jobType: "development",
    channel: "dm",
    style: "problem_first",
    postExcerpt:
      "[Hiring] Need a dev to build a booking page for my yoga studio. Clients should pick a class, pay, and get an email confirmation. Next.js preferred. Budget $800 fixed.",
    text: "Hey, so you need one page where clients pick a class, pay, and get a confirmation email. I built nearly the same thing for a dance school in Next.js with Stripe, and it replaced their phone bookings: {link}\n\nFor yours I'd set up the class schedule first, then Stripe checkout, then the emails, so you can test each part as it lands. The $800 fixed budget works for me.\n\nDo you already have a Stripe account, or should I set that up too?",
    facts:
      "Project: Booking site for a dance school (Next.js, Stripe). Outcome: replaced phone bookings. Rate: the posted budget fits your rate.",
  },
  {
    id: "dev-dm-scraper-codeword",
    jobType: "development",
    channel: "dm",
    style: "code_word",
    postExcerpt:
      "[Hiring] Python script to scrape product prices from 3 supplier sites into a Google Sheet every morning. Start your DM with 'pineapple' so I know you read this. Paying hourly.",
    text: "Pineapple. Do the supplier sites need a login, or are the prices public? That changes how I'd build it.\n\nI made a price tracker for a bike parts shop that does almost exactly this: Python and Playwright pull the prices, the Google Sheets API writes them in, and it flags any change overnight. Code is here: {link}\n\nFor your 3 sites I'd write one small scraper per site, so a layout change on one doesn't break the others, and schedule it for each morning. I can start this week.",
    facts:
      "Project: Price tracker for a bike parts shop (Python, Playwright, Google Sheets API). Outcome: runs daily and flags price changes overnight. Availability: can start this week.",
  },

  // ---- video -------------------------------------------------------------------------------
  {
    id: "video-comment-gaming",
    jobType: "video",
    channel: "comment",
    style: "proof_first",
    postExcerpt:
      "[Hiring] Editor for a weekly gaming YouTube channel, 15-20 min videos. Need jump cuts, captions and zooms on the funny bits.",
    text: "Captions plus punch-in zooms on the funny moments is most of what I do for a Minecraft channel right now. Sent you a DM.",
    facts:
      "Project: Ongoing edits for a Minecraft YouTube channel (Premiere Pro, After Effects). Outcome: viewers watch for longer since the switch to tighter cuts.",
  },
  {
    id: "video-dm-podcast-clips",
    jobType: "video",
    channel: "dm",
    style: "proof_first",
    postExcerpt:
      "[Hiring] Need someone to turn my 1 hour podcast episodes into 5 vertical clips each for TikTok and Reels. Ongoing, 2 episodes a week. Send examples.",
    text: "Here are some vertical clips I cut for a fitness podcast: {link}\n\nThose clips became the show's main way of finding new listeners, so I know how much the opening second matters. For yours I'd pull the strongest moments from each episode, open on the hook, and add bold captions, since most people watch on mute. 5 clips an episode at 2 episodes a week is a pace I can keep.\n\nWhich matters more to you right now, TikTok or Reels?",
    facts:
      "Project: Short-form clips for a fitness podcast (Premiere Pro, CapCut). Outcome: the clips became the show's main source of new listeners.",
  },
  {
    id: "video-dm-wedding-dm-only-rate",
    jobType: "video",
    channel: "dm",
    style: "rate_asked",
    postExcerpt:
      "[Hiring] Wedding video editor. I have about 6 hours of footage and need a 5 min highlight film with licensed music. Budget $400. DM me only, no comments please, and include your rate.",
    text: "Hi, about your wedding highlight film. Going from roughly 6 hours of footage to a 5 minute film with licensed music is the edit I do most. I cut highlight films for a small wedding studio in DaVinci Resolve, and they brought me back for a second season. A few are here: {link}\n\nI'd build the story around the vows and speeches first, then cut the music to the best moments. The $400 budget works for me.\n\nDo you have songs in mind, or should I pick from a licensed library?",
    facts:
      "Project: Highlight films for a small wedding studio (DaVinci Resolve). Outcome: the studio brought them back for a second season. Rate: the posted budget fits your rate.",
  },

  // ---- design ------------------------------------------------------------------------------
  {
    id: "design-comment-logo",
    jobType: "design",
    channel: "comment",
    style: "problem_first",
    postExcerpt:
      "[Hiring] Logo for a small coffee roastery called Ember & Oak. Needs to work printed on bags and stamped on cups. Budget $150.",
    text: "A logo that gets stamped on cups has to hold up in one colour at small sizes, so that's where I'd start. I did the same for a bakery's packaging and sent you a DM.",
    facts:
      "Project: Logo and packaging for a neighbourhood bakery (Illustrator). Outcome: one-colour mark used on boxes, stickers and stamps.",
  },
  {
    id: "design-dm-onboarding",
    jobType: "design",
    channel: "dm",
    style: "problem_first",
    postExcerpt:
      "[Hiring] Need a Figma redesign of our SaaS onboarding, 6 screens. Users drop off at the workspace setup step. Paid, remote.",
    text: "Hi! Sounds like the workspace setup step is where people give up, so that's the screen I'd look at first.\n\nI redesigned the onboarding for a scheduling app in Figma, and after the change fewer people quit during sign-up. The case study is here: {link}\n\nMy approach: map what each of the 6 screens asks for, cut or delay anything people don't need on day one, then prototype the new flow so you can click through it before any dev work.\n\nDo you have analytics showing where on that step people leave?",
    facts:
      "Project: Onboarding redesign for a scheduling app (Figma). Outcome: fewer users quit during sign-up after the redesign.",
  },
  {
    id: "design-dm-canva-templates",
    jobType: "design",
    channel: "dm",
    style: "question_first",
    postExcerpt:
      "[Hiring] Looking for someone to make 10 Instagram post templates in Canva for my skincare brand. Must be editable by me. Show me your work in the DM.",
    text: "Quick question first: do you already have brand colours and fonts, or should the templates set those too?\n\nI made a set of Canva templates for a candle shop owner who wanted to post without hiring a designer every week, and she still uses them for her own posts. You can see them here: {link}\n\nFor your brand I'd build the 10 templates around a few layouts (product shot, quote, before and after), lock the parts that keep it on-brand, and keep text and photos easy to swap.\n\nWould story sizes be useful too?",
    facts:
      "Project: Canva social templates for a candle shop (Canva). Outcome: the owner makes her own posts each week without a designer.",
  },

  // ---- writing -----------------------------------------------------------------------------
  {
    id: "writing-comment-linkedin",
    jobType: "writing",
    channel: "comment",
    style: "proof_first",
    postExcerpt:
      "[Hiring] Ghostwriter for LinkedIn posts for a B2B logistics founder. 3 posts a week, in his voice, no AI slop.",
    text: "Getting a founder's voice right mostly comes down to interviewing them well, and that's how I run the weekly posts I ghostwrite for a fintech founder. Sent you a DM.",
    facts:
      "Project: LinkedIn ghostwriting for a fintech founder. Outcome: posts went from occasional to weekly, with more inbound leads.",
  },
  {
    id: "writing-dm-seo-rate",
    jobType: "writing",
    channel: "dm",
    style: "rate_asked",
    postExcerpt:
      "[Hiring] Need blog posts for a pet insurance website, 1,500 words each, SEO focused. Send your rate per article and a sample.",
    text: "Here's a sample from a series of SEO articles I wrote for a group of vet clinics. Several of them reached the first page of Google for their target terms: {link}\n\nPet insurance readers usually want a straight answer on what's covered and what it costs, so I'd lead each post with that and work the keywords in around it. Once I know how many 1,500 word articles you need a month, I can send you a per-article quote.\n\nDo you already have a keyword list, or should I suggest topics?",
    facts:
      "Project: SEO blog articles for a group of vet clinics. Outcome: several articles reached the first page of Google for their target terms.",
  },
  {
    id: "writing-dm-novel-edit",
    jobType: "writing",
    channel: "dm",
    style: "problem_first",
    postExcerpt:
      "[Hiring] Editor to proofread and tighten my fantasy novel manuscript before I query agents. About 90k words. Deadline end of next month.",
    text: "Hi, so you want the manuscript clean and tight before it goes out to agents.\n\nI did a line edit on a debut fantasy novel, mostly cutting repetition and fixing pacing in the slow chapters, and the author signed with an agent after querying. There's a short before and after here: {link}\n\nFor around 90k words I'd edit the opening chapters first and send them over, so you can check my changes keep your voice, then finish the rest well before your deadline.\n\nWhich feels weaker to you right now, the pacing or the prose?",
    facts:
      "Project: Line edit of a debut fantasy novel. Outcome: the author signed with a literary agent after querying.",
  },

  // ---- general -----------------------------------------------------------------------------
  {
    id: "general-comment-question",
    jobType: "general",
    channel: "comment",
    style: "question_first",
    postExcerpt:
      "[Hiring] Need help setting up automated invoice reminders, not sure what tool to use. Small business, paid.",
    text: "Do your invoices already live in something like QuickBooks or Xero? Most of those can send reminders on their own, so this might be a quick setup rather than a custom build.",
    facts: "Broad match. Role: Bookkeeping assistant for small businesses.",
  },
  {
    id: "general-comment-dm-only",
    jobType: "general",
    channel: "comment",
    style: "dm_only",
    postExcerpt:
      "[Hiring] Virtual assistant for inbox and calendar, around 10 hrs/week. DM only, comments will be ignored.",
    text: "Sent you a DM.",
    facts:
      "Role: Virtual assistant for a property manager. Highlights: ran the inbox and calendar.",
  },
  {
    id: "general-dm-airtable-broad",
    jobType: "general",
    channel: "dm",
    style: "broad",
    postExcerpt:
      "[Hiring] Looking for someone to help clean up our messy Airtable base. Lots of duplicate records and broken links between tables. Paid hourly.",
    text: "Hey, duplicate records plus broken links between tables is a fixable mess, it just has to be done in the right order.\n\nI worked as an operations assistant at a small online retailer, where most of my job was keeping product and order records tidy and building simple automations so they stayed that way. Some of that work is here: {link}\n\nI'd merge the duplicates first, then repair the links, then add a couple of checks so new duplicates get caught early.\n\nRoughly how many tables are in the base?",
    facts:
      "Broad match. Role: Operations assistant at a small online retailer. Highlights: kept product and order records tidy; built simple automations.",
  },
  {
    id: "general-dm-store-migration",
    jobType: "general",
    channel: "dm",
    style: "problem_first",
    postExcerpt:
      "[Hiring] Need someone to move about 400 product listings from an old WooCommerce site to Shopify, including images and variants. Tell me how you'd approach it.",
    text: "Moving 400 listings with images and variants is mostly about getting the variant mapping right before anything is imported.\n\nI moved a clothing brand's store from WooCommerce to Shopify and got the full catalogue across with no broken product pages: {link}\n\nHow I'd do yours: export everything, clean up the variant data in a spreadsheet, test an import with a handful of products, then run the rest once you've checked those. I can start this week.\n\nAre you keeping the same product URLs, or will you need redirects too?",
    facts:
      "Project: Store migration from WooCommerce to Shopify for a clothing brand. Outcome: the full catalogue moved with no broken product pages. Availability: can start this week.",
  },
];
