import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { footerColumns, legalLinks } from "@/lib/nav";

const linkClass =
  "rounded-sm text-[15px] text-foreground/85 transition-colors duration-300 ease-snappy hover:text-foreground focus-visible:underline focus-visible:outline-none";

export function SiteFooter() {
  return (
    <footer
      data-header-theme="dark"
      className="dark bg-background text-foreground"
    >
      <div className="mx-auto grid max-w-[1440px] gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="flex flex-col items-start gap-4">
          <Logo className="text-2xl" />
          <p className="max-w-[20rem] leading-relaxed text-muted-foreground">
            Find freelance jobs on Reddit and reply in your own voice.
          </p>
        </div>
        <nav
          aria-label="Footer"
          className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-4"
        >
          {footerColumns.map((column) => (
            <div key={column.label} className="flex flex-col gap-3">
              <h2 className="text-sm text-muted-foreground">{column.label}</h2>
              <ul className="flex flex-col gap-2.5">
                {column.items.map((item) => (
                  <li key={item.title}>
                    <Link href={item.href!} className={linkClass}>
                      {item.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            © {new Date().getFullYear()} Redlance. Not affiliated with Reddit,
            Inc.
          </p>
          <ul className="flex gap-6">
            {legalLinks.map((item) => (
              <li key={item.title}>
                <Link href={item.href!} className={linkClass}>
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
