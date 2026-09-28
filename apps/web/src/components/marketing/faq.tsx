import { PlusIcon } from "lucide-react";
import { faq } from "@/lib/faq";
import { Frame, SectionChip, TwoToneHeading } from "./primitives";

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faq.map(({ question, answer }) => ({
    "@type": "Question",
    name: question,
    acceptedAnswer: { "@type": "Answer", text: answer },
  })),
};

export function Faq() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="border-b border-border bg-background"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <Frame className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex flex-col items-start gap-5 px-4 py-20 sm:px-12 sm:py-24 lg:px-16">
          <SectionChip>FAQ</SectionChip>
          <TwoToneHeading
            id="faq-heading"
            lead="Questions, answered."
            rest="The short version of how Redlance works."
          />
        </div>
        <div className="border-t border-border px-4 py-6 sm:px-12 lg:border-t-0 lg:border-l lg:py-16">
          {/* Native <details>: works without JavaScript and the answers stay in
              the page for search and AI engines. */}
          {faq.map(({ question, answer }) => (
            <details
              key={question}
              className="group border-b border-border last:border-b-0"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 focus-visible:underline focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                <h3 className="text-lg font-medium tracking-[-0.01em]">
                  {question}
                </h3>
                <PlusIcon
                  aria-hidden="true"
                  className="size-5 shrink-0 text-muted-foreground transition-transform duration-300 ease-snappy group-open:rotate-45"
                />
              </summary>
              <p className="max-w-[40rem] pb-6 leading-relaxed text-muted-foreground">
                {answer}
              </p>
            </details>
          ))}
        </div>
      </Frame>
    </section>
  );
}
