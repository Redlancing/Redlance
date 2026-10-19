// Homepage FAQ. Used for the visible list and the FAQPage structured data,
// so the two always match. Answers are kept to 40–60 words (see CLAUDE.md, AEO).
export const faq = [
  {
    question: "What is Redlance?",
    answer:
      "Redlance is an AI tool that finds freelance jobs on Reddit, matches them to your skills, and drafts replies in your voice. It watches hiring subreddits every few minutes, scores each post from 0 to 100 against your profile, and sends good matches to Telegram with a short reply ready to edit.",
  },
  {
    question: "Does Redlance post on Reddit for me?",
    answer:
      "No. Redlance never posts, comments or sends messages from your Reddit account, and there is no auto-post option in any plan. It writes a draft, you edit it, then you open the post and send the reply yourself. That keeps your account safe and every message genuinely yours.",
  },
  {
    question: "Which subreddits does Redlance watch?",
    answer:
      "Redlance watches more than 150 hiring subreddits, from r/forhire and r/hiring to r/DesignJobs and r/HireaWriter, so you don't have to pick any. It shows you only the posts that match your skills, keeps posts where clients are hiring, and skips [For Hire] ads from other freelancers.",
  },
  {
    question: "How fast are the alerts?",
    answer:
      "On the Pro plan, a good match reaches you on Telegram within minutes of being posted, because Redlance checks every hiring subreddit every few minutes. On the Free plan, alerts arrive 30 to 60 minutes after posting. Speed matters on Reddit, where clients often hire one of the first people to reply.",
  },
  {
    question: "Will my replies sound like AI?",
    answer:
      "Drafts are kept short, mention the client's specific problem and link one relevant portfolio piece, which is how good human replies read. Redlance learns your tone from replies you have written before, and you can edit every draft before sending, so the final message is always yours.",
  },
  {
    question: "What do subreddit insights show?",
    answer:
      "Insights show, for each subreddit you watch, how many hiring posts appear each week, how many match your skills, the range of posted budgets, and the hours clients post most. They only appear once a subreddit has enough posts to be meaningful, and they are part of the Pro plan.",
  },
  {
    question: "How much does Redlance cost?",
    answer:
      "Redlance has a free plan with delayed alerts, a few drafts a day and a basic reply tracker. Pro adds instant alerts, unlimited drafts, voice learning, follow-up drafts and subreddit insights. Prices are in Indian rupees and you can pay with UPI or card. Final Pro pricing will be announced at launch.",
  },
  {
    question: "Is Redlance affiliated with Reddit?",
    answer:
      "No. Redlance is an independent tool and is not affiliated with, endorsed by or sponsored by Reddit, Inc. It reads public hiring posts from subreddits and helps you reply faster, but every reply is sent by you, from your own account, following each subreddit's rules.",
  },
] as const;
