const REPO_URL = "https://github.com/jamalla/langgraph-copilotkit-a2ui-product-assistant";

/**
 * The styling guide for whoever maintains the generated UI. Private until it
 * is shared from the artifact page, so a visitor without access sees a sign-in
 * screen rather than the article.
 */
const GUIDE_URL = "https://claude.ai/code/artifact/a38e0e14-6380-4b40-91f8-59fde7b407b8";

/**
 * Header links: the interactive explainer, and the source.
 *
 * Server component - these are two anchors with no state, so shipping a client
 * bundle for them would be waste. The icons are inline SVG rather than an icon
 * package: two glyphs do not justify a dependency, and inline paths cannot fail
 * to load.
 *
 * Sized and styled to match ThemeToggle, since they sit next to it.
 */

const BUTTON =
  "grid size-8 place-items-center rounded-control border border-line bg-surface " +
  "text-ink-muted transition hover:border-line-strong hover:text-ink " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-brand";

export function ProjectLinks() {
  return (
    <div className="flex items-center gap-2">
      <a
        href="/explainer"
        target="_blank"
        rel="noopener noreferrer"
        title="How this UI is generated - a twelve-step narrated walkthrough"
        aria-label="Open the interactive explainer in a new tab"
        className={BUTTON}
      >
        {/* Play-in-a-frame: it is a player, not a document. */}
        <svg
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="2.5" y="4" width="19" height="16" rx="2.5" />
          <path d="M10 9.2v5.6l4.6-2.8z" fill="currentColor" stroke="none" />
        </svg>
      </a>

      <a
        href={GUIDE_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="Four levers on generated UI: how to style what the agent builds"
        aria-label="Read the generated-UI styling guide in a new tab"
        className={BUTTON}
      >
        {/* An open book: a guide, distinct from the player and the source. */}
        <svg
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 6.5C10.5 5.2 8.6 4.6 6 4.6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1c2.6 0 4.5.6 6 1.9 1.5-1.3 3.4-1.9 6-1.9a1 1 0 0 0 1-1v-11a1 1 0 0 0-1-1c-2.6 0-4.5.6-6 1.9z" />
          <path d="M12 6.5v12.9" />
        </svg>
      </a>

      <a
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="Source on GitHub"
        aria-label="View the source on GitHub"
        className={BUTTON}
      >
        {/* The GitHub mark, as a single filled path. */}
        <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
        </svg>
      </a>
    </div>
  );
}
