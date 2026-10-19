export const CATEGORIES = [
  {
    id: "development",
    name: "Development",
    hint: "Websites, apps, bots, automation",
  },
  {
    id: "games",
    name: "Game development",
    hint: "Unity, Unreal, Godot, Roblox, mods",
  },
  { id: "design", name: "Design", hint: "Logos, brand, UI/UX, print" },
  {
    id: "art",
    name: "Art & illustration",
    hint: "Commissions, characters, comics, emotes",
  },
  {
    id: "3d",
    name: "3D & animation",
    hint: "Modeling, rigging, rendering, CAD",
  },
  { id: "video", name: "Video", hint: "Editing, motion graphics, thumbnails" },
  {
    id: "photo",
    name: "Photo editing",
    hint: "Retouching, restoration, compositing",
  },
  {
    id: "audio",
    name: "Audio & voice",
    hint: "Voice-over, music, mixing, podcasts",
  },
  {
    id: "writing",
    name: "Writing & translation",
    hint: "Copy, articles, editing, translation",
  },
  { id: "marketing", name: "Marketing", hint: "SEO, social media, ads, email" },
  {
    id: "data",
    name: "Data & AI",
    hint: "Analysis, spreadsheets, scraping, ML",
  },
  {
    id: "admin",
    name: "Admin & support",
    hint: "Virtual assistance, data entry, research",
  },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [
  CategoryId,
  ...CategoryId[],
];

export type Skill = {
  id: string;
  name: string;
  category: CategoryId;
  aliases: readonly string[];
  /** GitHub repo `language` values that imply this skill (slice 3). */
  githubLanguages?: readonly string[];
  /** GitHub repo topics that imply this skill (slice 3). */
  githubTopics?: readonly string[];
  /** Never delete a skill: retire it so saved profiles stay valid. */
  retired?: boolean;
};

type Def = [
  id: string,
  name: string,
  aliases?: string[],
  github?: { languages?: string[]; topics?: string[] },
];

function group(category: CategoryId, defs: Def[]): Skill[] {
  return defs.map(([id, name, aliases = [], github]) => ({
    id,
    name,
    category,
    aliases,
    ...(github?.languages ? { githubLanguages: github.languages } : {}),
    ...(github?.topics ? { githubTopics: github.topics } : {}),
  }));
}

// Order inside a group = "popular first" for skillsForCategories().
export const SKILLS: readonly Skill[] = [
  ...group("development", [
    [
      "javascript",
      "JavaScript",
      ["js", "es6"],
      { languages: ["JavaScript"], topics: ["javascript"] },
    ],
    [
      "typescript",
      "TypeScript",
      ["ts"],
      { languages: ["TypeScript"], topics: ["typescript"] },
    ],
    [
      "react",
      "React",
      ["react.js", "reactjs"],
      { topics: ["react", "reactjs"] },
    ],
    ["nextjs", "Next.js", ["nextjs", "next js"], { topics: ["nextjs"] }],
    [
      "nodejs",
      "Node.js",
      ["node", "express", "nestjs"],
      { topics: ["nodejs", "express", "nestjs"] },
    ],
    ["python", "Python", ["py"], { languages: ["Python"], topics: ["python"] }],
    [
      "html-css",
      "HTML & CSS",
      ["html", "css", "html5", "css3"],
      { languages: ["HTML", "CSS", "SCSS"] },
    ],
    [
      "wordpress",
      "WordPress",
      ["wp", "woocommerce"],
      { topics: ["wordpress", "woocommerce"] },
    ],
    [
      "shopify",
      "Shopify",
      ["liquid"],
      { languages: ["Liquid"], topics: ["shopify"] },
    ],
    ["php", "PHP", [], { languages: ["PHP"] }],
    ["laravel", "Laravel", [], { topics: ["laravel"] }],
    ["django", "Django", [], { topics: ["django"] }],
    ["fastapi", "FastAPI", ["flask"], { topics: ["fastapi", "flask"] }],
    [
      "vue",
      "Vue",
      ["vue.js", "vuejs", "nuxt"],
      { languages: ["Vue"], topics: ["vue", "vuejs", "nuxt"] },
    ],
    ["angular", "Angular", [], { topics: ["angular"] }],
    [
      "svelte",
      "Svelte",
      ["sveltekit"],
      { languages: ["Svelte"], topics: ["svelte", "sveltekit"] },
    ],
    ["tailwind", "Tailwind CSS", ["tailwindcss"], { topics: ["tailwindcss"] }],
    ["react-native", "React Native", [], { topics: ["react-native"] }],
    ["flutter", "Flutter", [], { languages: ["Dart"], topics: ["flutter"] }],
    [
      "ios",
      "iOS development",
      ["swiftui", "ios app", "swift"],
      { languages: ["Swift", "Objective-C"], topics: ["ios", "swiftui"] },
    ],
    [
      "android",
      "Android development",
      ["android app", "jetpack compose", "kotlin"],
      { languages: ["Kotlin"], topics: ["android"] },
    ],
    ["java", "Java", [], { languages: ["Java"] }],
    [
      "spring",
      "Spring Boot",
      ["spring"],
      { topics: ["spring-boot", "spring"] },
    ],
    [
      "csharp",
      "C#",
      ["c sharp", ".net", "dotnet", "asp.net"],
      { languages: ["C#"], topics: ["dotnet", "csharp"] },
    ],
    ["cpp", "C / C++", ["c++", "cplusplus", "c"], { languages: ["C++", "C"] }],
    ["go", "Go", ["golang"], { languages: ["Go"], topics: ["golang"] }],
    ["rust", "Rust", [], { languages: ["Rust"] }],
    [
      "ruby",
      "Ruby on Rails",
      ["rails", "ror", "ruby"],
      { languages: ["Ruby"], topics: ["rails", "ruby-on-rails"] },
    ],
    ["webflow", "Webflow", []],
    ["wix-squarespace", "Wix / Squarespace", ["wix", "squarespace"]],
    [
      "no-code",
      "No-code tools",
      ["zapier", "make.com", "bubble", "airtable", "n8n"],
    ],
    [
      "postgresql",
      "PostgreSQL",
      ["postgres"],
      { topics: ["postgresql", "postgres"] },
    ],
    ["mysql", "MySQL", [], { topics: ["mysql"] }],
    ["mongodb", "MongoDB", ["mongo"], { topics: ["mongodb"] }],
    ["firebase", "Firebase", [], { topics: ["firebase"] }],
    ["supabase", "Supabase", [], { topics: ["supabase"] }],
    ["graphql", "GraphQL", [], { topics: ["graphql"] }],
    [
      "rest-api",
      "APIs & integrations",
      ["api", "apis", "rest api", "api integration"],
      { topics: ["rest-api", "api"] },
    ],
    [
      "payments",
      "Payments integration",
      ["stripe", "paypal"],
      { topics: ["stripe"] },
    ],
    ["aws", "AWS", ["amazon web services"], { topics: ["aws"] }],
    ["gcp", "Google Cloud", ["gcp"], { topics: ["gcp", "google-cloud"] }],
    ["azure", "Azure", [], { topics: ["azure"] }],
    ["docker", "Docker", [], { languages: ["Dockerfile"], topics: ["docker"] }],
    ["kubernetes", "Kubernetes", ["k8s"], { topics: ["kubernetes"] }],
    [
      "devops",
      "DevOps & CI/CD",
      ["ci/cd", "github actions", "terraform"],
      { languages: ["HCL"], topics: ["devops", "terraform"] },
    ],
    [
      "linux",
      "Linux & servers",
      ["sysadmin", "bash", "vps"],
      { languages: ["Shell"] },
    ],
    [
      "automation",
      "Scripting & automation",
      ["automation", "scripting"],
      { topics: ["automation"] },
    ],
    [
      "bots",
      "Discord & Telegram bots",
      ["discord bot", "telegram bot", "chatbot"],
      { topics: ["discord-bot", "telegram-bot"] },
    ],
    [
      "browser-extensions",
      "Browser extensions",
      ["chrome extension"],
      { topics: ["chrome-extension"] },
    ],
    [
      "desktop-apps",
      "Desktop apps",
      ["electron", "tauri"],
      { topics: ["electron", "tauri"] },
    ],
    [
      "blockchain",
      "Blockchain & smart contracts",
      ["solidity", "web3", "smart contracts"],
      { languages: ["Solidity"], topics: ["web3", "solidity", "ethereum"] },
    ],
    [
      "qa-testing",
      "QA & testing",
      ["testing", "playwright", "cypress", "selenium testing"],
      { topics: ["testing", "playwright", "cypress"] },
    ],
  ]),
  ...group("games", [
    [
      "unity",
      "Unity",
      ["unity3d"],
      { languages: ["ShaderLab"], topics: ["unity", "unity3d"] },
    ],
    [
      "unreal",
      "Unreal Engine",
      ["ue5", "ue4", "blueprints"],
      { topics: ["unreal-engine"] },
    ],
    ["godot", "Godot", [], { languages: ["GDScript"], topics: ["godot"] }],
    [
      "roblox",
      "Roblox",
      ["luau", "roblox studio"],
      { languages: ["Luau"], topics: ["roblox"] },
    ],
    ["game-design", "Game design", ["level design"]],
    ["game-art", "Game art & assets", ["game assets", "2d assets"]],
    ["pixel-art", "Pixel art", ["sprites"]],
    [
      "minecraft",
      "Minecraft plugins & mods",
      ["spigot", "minecraft mods"],
      { topics: ["minecraft", "spigot"] },
    ],
    ["fivem", "FiveM & GTA mods", ["gta mods"], { topics: ["fivem"] }],
    ["gamemaker", "GameMaker", [], { languages: ["Game Maker Language"] }],
    ["lua", "Lua scripting", [], { languages: ["Lua"] }],
  ]),
  ...group("design", [
    ["logo-design", "Logo design", ["logo", "logos"]],
    [
      "brand-identity",
      "Brand identity",
      ["branding", "brand design", "style guide"],
    ],
    ["graphic-design", "Graphic design", ["graphics"]],
    ["ui-design", "UI design", ["user interface", "web design", "app design"]],
    [
      "ux-design",
      "UX design",
      ["ux", "user research", "wireframing", "prototyping"],
    ],
    ["figma", "Figma", []],
    ["illustrator", "Adobe Illustrator", ["illustrator"]],
    ["indesign", "Adobe InDesign", ["indesign"]],
    ["canva", "Canva", []],
    [
      "social-media-graphics",
      "Social media graphics",
      ["instagram posts", "banners"],
    ],
    [
      "print-design",
      "Print design",
      ["flyers", "posters", "brochures", "business cards"],
    ],
    ["packaging-design", "Packaging design", ["packaging", "label design"]],
    [
      "presentation-design",
      "Presentation design",
      ["pitch deck", "powerpoint", "slides", "keynote"],
    ],
    [
      "merch-design",
      "T-shirt & merch design",
      ["t-shirt design", "apparel design", "merch"],
    ],
    ["book-cover-design", "Book cover design", ["book cover"]],
    ["infographics", "Infographics", []],
  ]),
  ...group("art", [
    ["illustration", "Illustration", ["illustrations"]],
    ["digital-art", "Digital art", ["digital painting"]],
    ["character-design", "Character design", ["character art"]],
    ["concept-art", "Concept art", []],
    ["anime-art", "Anime art", ["anime style"]],
    ["comics", "Comics & manga", ["comic art", "manga", "webtoon"]],
    ["portraits", "Portraits", ["portrait", "pet portrait"]],
    ["vtuber-art", "VTuber models & art", ["vtuber", "live2d", "vtuber model"]],
    ["emotes", "Emotes & badges", ["twitch emotes", "discord emotes"]],
    ["childrens-books", "Children's book illustration", ["kids book"]],
    ["tattoo-design", "Tattoo design", ["tattoo"]],
    [
      "traditional-art",
      "Traditional art",
      ["painting", "drawing", "watercolor"],
    ],
    ["procreate", "Procreate", []],
  ]),
  ...group("3d", [
    ["blender", "Blender", [], { topics: ["blender"] }],
    ["3d-modeling", "3D modeling", ["3d model", "3d models"]],
    ["3d-animation", "3D animation", []],
    ["rigging", "Rigging", []],
    ["texturing", "Texturing", ["substance painter", "pbr"]],
    [
      "product-rendering",
      "Product rendering",
      ["3d render", "rendering", "keyshot"],
    ],
    ["archviz", "Architectural visualization", ["sketchup", "3ds max"]],
    ["cad", "CAD", ["autocad", "solidworks", "fusion 360"]],
    ["3d-printing", "3D printing models", ["stl", "3d print"]],
    ["maya", "Maya", ["autodesk maya"]],
    ["zbrush", "ZBrush", ["sculpting"]],
    ["cinema-4d", "Cinema 4D", ["c4d"]],
    ["vrchat-avatars", "VRChat avatars", ["vrchat"]],
  ]),
  ...group("video", [
    ["video-editing", "Video editing", ["video editor", "video edit"]],
    ["youtube-editing", "YouTube editing", ["youtube videos"]],
    ["short-form-video", "Short-form video", ["tiktok", "reels", "shorts"]],
    ["premiere-pro", "Premiere Pro", ["premiere", "adobe premiere"]],
    ["after-effects", "After Effects", ["ae"]],
    ["davinci-resolve", "DaVinci Resolve", ["resolve"]],
    ["final-cut-pro", "Final Cut Pro", ["fcp", "final cut"]],
    ["capcut", "CapCut", []],
    ["motion-graphics", "Motion graphics", ["motion design", "mograph"]],
    ["2d-animation", "2D animation", ["animation", "explainer video"]],
    ["thumbnails", "Thumbnail design", ["thumbnail", "youtube thumbnails"]],
    ["color-grading", "Color grading", ["colour grading", "color correction"]],
    ["subtitles", "Subtitles & captions", ["captions", "subtitling"]],
    ["vfx", "VFX", ["visual effects", "compositing"]],
    ["videography", "Videography", ["filming", "camera operator"]],
  ]),
  ...group("photo", [
    ["photoshop", "Photoshop", ["adobe photoshop", "ps"]],
    ["photo-retouching", "Photo retouching", ["retouching", "skin retouch"]],
    ["photo-restoration", "Photo restoration", ["restoration", "colorization"]],
    ["photo-manipulation", "Photo manipulation", ["photoshop edits"]],
    [
      "background-removal",
      "Background removal",
      ["remove background", "cutout"],
    ],
    ["product-photo-editing", "Product photo editing", ["ecommerce photos"]],
    [
      "real-estate-photo-editing",
      "Real estate photo editing",
      ["virtual staging", "hdr"],
    ],
    ["lightroom", "Lightroom", []],
    ["photography", "Photography", ["photographer", "photoshoot"]],
  ]),
  ...group("audio", [
    ["voice-over", "Voice-over", ["voice acting", "voiceover", "vo"]],
    ["music-production", "Music production", ["beats", "producer"]],
    ["mixing-mastering", "Mixing & mastering", ["mixing", "mastering"]],
    ["podcast-editing", "Podcast editing", ["podcast"]],
    ["audio-editing", "Audio editing", ["audio cleanup"]],
    ["sound-design", "Sound design", ["sfx", "sound effects"]],
    ["composing", "Composing", ["composer", "soundtrack", "game music"]],
    ["audiobook-narration", "Audiobook narration", ["narration", "audiobook"]],
    ["singing", "Singing & vocals", ["vocals", "singer"]],
    ["jingles", "Jingles", []],
  ]),
  ...group("writing", [
    ["copywriting", "Copywriting", ["copy", "sales copy"]],
    [
      "content-writing",
      "Content writing",
      ["blog posts", "articles", "blogging"],
    ],
    ["seo-writing", "SEO writing", ["seo content"]],
    ["ghostwriting", "Ghostwriting", ["ghostwriter"]],
    [
      "editing-proofreading",
      "Editing & proofreading",
      ["proofreading", "copyediting", "line editing"],
    ],
    ["technical-writing", "Technical writing", ["documentation", "docs"]],
    [
      "scriptwriting",
      "Scriptwriting",
      ["scripts", "youtube scripts", "screenwriting"],
    ],
    ["creative-writing", "Creative writing", ["fiction", "short stories"]],
    ["resume-writing", "Resume writing", ["cv writing", "cover letters"]],
    ["grant-writing", "Grant writing", ["grants", "proposals"]],
    ["ux-writing", "UX writing", ["microcopy"]],
    ["product-descriptions", "Product descriptions", []],
    ["newsletter-writing", "Newsletter writing", []],
    ["translation", "Translation", ["translator", "localization"]],
    ["transcription", "Transcription", ["transcribe"]],
  ]),
  ...group("marketing", [
    ["seo", "SEO", ["search engine optimization"]],
    [
      "social-media-management",
      "Social media management",
      ["smm", "social media manager", "community management"],
    ],
    ["paid-ads", "Paid ads", ["ppc", "google ads", "facebook ads", "meta ads"]],
    [
      "email-marketing",
      "Email marketing",
      ["klaviyo", "mailchimp", "newsletters"],
    ],
    ["ugc", "UGC content", ["ugc creator", "user-generated content"]],
    ["content-marketing", "Content marketing", []],
    ["marketing-strategy", "Marketing strategy", ["growth", "go-to-market"]],
    [
      "lead-generation",
      "Lead generation",
      ["leads", "cold outreach", "cold email"],
    ],
    [
      "analytics-tracking",
      "Analytics & tracking",
      ["google analytics", "ga4", "tag manager"],
    ],
    [
      "marketplace-listings",
      "Amazon & Etsy listings",
      ["amazon fba", "etsy seo", "listings"],
    ],
    ["influencer-marketing", "Influencer marketing", []],
    ["pr-outreach", "PR & outreach", ["public relations", "press release"]],
  ]),
  ...group("data", [
    ["data-analysis", "Data analysis", ["analytics", "data analyst"]],
    [
      "excel",
      "Excel & Google Sheets",
      ["spreadsheets", "google sheets", "vba"],
      { languages: ["VBA"] },
    ],
    ["sql", "SQL", [], { languages: ["TSQL", "PLpgSQL", "PLSQL"] }],
    ["dashboards", "Power BI & Tableau", ["power bi", "tableau", "dashboards"]],
    [
      "web-scraping",
      "Web scraping",
      ["scraper", "scraping", "crawler"],
      { topics: ["web-scraping", "scraper", "puppeteer"] },
    ],
    [
      "llm-apps",
      "AI & LLM apps",
      ["chatgpt", "openai", "gpt", "ai agents", "rag", "langchain"],
      { topics: ["llm", "openai", "langchain", "rag"] },
    ],
    [
      "machine-learning",
      "Machine learning",
      ["ml", "deep learning", "pytorch", "tensorflow"],
      {
        languages: ["Jupyter Notebook"],
        topics: ["machine-learning", "deep-learning", "pytorch", "tensorflow"],
      },
    ],
    [
      "computer-vision",
      "Computer vision",
      ["opencv", "image recognition"],
      { topics: ["computer-vision", "opencv"] },
    ],
    [
      "data-engineering",
      "Data engineering",
      ["etl", "airflow", "data pipelines"],
    ],
    ["statistics", "Statistics", ["spss", "stata", "r"], { languages: ["R"] }],
  ]),
  ...group("admin", [
    ["virtual-assistant", "Virtual assistance", ["va", "virtual assistant"]],
    ["data-entry", "Data entry", []],
    [
      "customer-support",
      "Customer support",
      ["customer service", "support agent"],
    ],
    ["research", "Online research", ["research", "lead research"]],
    [
      "project-management",
      "Project management",
      ["pm", "notion", "asana", "trello"],
    ],
    ["bookkeeping", "Bookkeeping", ["quickbooks", "xero", "accounting"]],
    ["appointment-setting", "Appointment setting", ["cold calling", "sdr"]],
    [
      "store-management",
      "E-commerce store management",
      ["store management", "product listing"],
    ],
    [
      "community-moderation",
      "Community moderation",
      ["discord moderator", "moderation"],
    ],
  ]),
];

export const SKILL_BY_ID: ReadonlyMap<string, Skill> = new Map(
  SKILLS.map((s) => [s.id, s]),
);

export function normalizeSkillName(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

const BY_LABEL: ReadonlyMap<string, Skill> = new Map(
  SKILLS.flatMap((s) =>
    [s.id, s.name, ...s.aliases].map(
      (label) => [normalizeSkillName(label), s] as const,
    ),
  ),
);

/** Exact lookup by id, name or alias (case- and spacing-insensitive). */
export function findSkill(name: string): Skill | undefined {
  return BY_LABEL.get(normalizeSkillName(name));
}

/** Picker search: exact > prefix > substring; the user's job types first within each rank. */
export function searchSkills(
  query: string,
  options: { categories?: readonly string[]; limit?: number } = {},
): Skill[] {
  const q = normalizeSkillName(query);
  if (!q) return [];
  const preferred = new Set(options.categories ?? []);
  const scored: { skill: Skill; score: number }[] = [];
  for (const skill of SKILLS) {
    if (skill.retired) continue;
    const labels = [skill.name, ...skill.aliases].map(normalizeSkillName);
    const rank = labels.includes(q)
      ? 0
      : labels.some((l) => l.startsWith(q) || l.includes(` ${q}`))
        ? 1
        : labels.some((l) => l.includes(q))
          ? 2
          : -1;
    if (rank < 0) continue;
    scored.push({
      skill,
      score: rank * 2 + (preferred.has(skill.category) ? 0 : 1),
    });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, options.limit ?? 12)
    .map((s) => s.skill);
}

/** First `limit` (non-retired) skills of the given job types, in taxonomy order. */
export function skillsForCategories(
  categories: readonly string[],
  limit: number,
): Skill[] {
  return SKILLS.filter(
    (s) => !s.retired && categories.includes(s.category),
  ).slice(0, limit);
}
