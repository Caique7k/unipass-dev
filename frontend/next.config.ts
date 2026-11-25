import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  async rewrites() {
    // Só existe com BACKEND_URL definida (ex.: deploy na Vercel). Sem ela, o
    // destino viraria "undefined/:path*" e o next build falharia.
    if (!process.env.BACKEND_URL) return [];

    return [
      {
        source: "/api/:path*",
        destination: `${process.env.BACKEND_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;