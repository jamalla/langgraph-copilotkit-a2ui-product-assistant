import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "A2UI Product Assistant",
  description:
    "Product catalog powered by a LangGraph multi-agent backend that renders live UI via A2UI.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Applies the saved theme before first paint so a dark-mode user never
          sees a white flash. Inline and synchronous by necessity.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("theme");if(t&&t!=="system")document.documentElement.setAttribute("data-theme",t)}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-dvh bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
