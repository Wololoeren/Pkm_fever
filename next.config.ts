import type { NextConfig } from "next";

/** Static export, so the whole game is a folder of files that GitHub Pages can
 * serve. NEXT_BASE_PATH is set by the Pages workflow to the repository name. */
const basePath = process.env.NEXT_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
