import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Default is 1MB — CSV snapshots from a real agency can easily exceed
    // that, and the admin upload modal sends up to three files in one
    // multipart Server Action request.
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
