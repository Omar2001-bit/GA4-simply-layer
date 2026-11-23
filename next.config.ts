import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin root to this project; a stray package-lock.json in the parent
    // (home) dir otherwise makes Turbopack pick the wrong workspace root.
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
