"use client";

import { CopilotKitProvider, CopilotPopup } from "@copilotkit/react-core/v2";

/**
 * Client-side CopilotKit wiring.
 *
 * There is deliberately no `a2ui` prop here. The renderer activates on its own
 * once the runtime reports that A2UI is configured (see app/api/copilotkit/route.ts).
 * The prop exists only to override the theme, and we theme through CSS instead —
 * see app/a2ui-theme.css.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      {children}
      <CopilotPopup
        agentId="product_agent"
        labels={{
          chatInputPlaceholder: "Ask about the catalog…",
        }}
      />
    </CopilotKitProvider>
  );
}
