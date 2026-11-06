import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@prisma/client", "blaaiz-nodejs-sdk"],
};
export default config;
