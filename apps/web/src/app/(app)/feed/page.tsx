import { MousePointerClick } from "lucide-react";

// /feed on a wide screen: the right-hand pane before a match is picked (hidden on phones).
export default function FeedPage() {
  return (
    <div className="flex h-full min-h-80 items-center justify-center px-8">
      <div className="max-w-xs text-center text-sm text-stone">
        <MousePointerClick
          className="mx-auto size-5 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="mt-3 text-foreground">
          Pick a gig to read it and draft a reply.
        </p>
        <p className="mt-1">
          Use <kbd className="font-sans">j</kbd> and{" "}
          <kbd className="font-sans">k</kbd> to move,{" "}
          <kbd className="font-sans">Enter</kbd> to open.
        </p>
      </div>
    </div>
  );
}
