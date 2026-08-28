import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @a2ui/kit ships TypeScript source rather than a build output, so Next has
  // to compile it. Zero build step for the package, one line here.
  transpilePackages: ["@a2ui/kit"],

  // The seed catalog lives at the monorepo root, outside this app's folder.
  // Telling Next where the workspace root is keeps file tracing correct for
  // `next build` and silences the "inferred workspace root" warning.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),

  // The API route reads data/products.json from disk at request time, so that
  // file has to be traced into the production bundle.
  outputFileTracingIncludes: {
    "/api/products": ["../../data/products.json"],
  },
};

export default nextConfig;
