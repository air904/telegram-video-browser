/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // These Node.js modules are server-only; tell webpack to ignore them on the client
      config.resolve.fallback = {
        ...config.resolve.fallback,
        net: false,
        tls: false,
        fs: false,
        crypto: false,
        stream: false,
        path: false,
        os: false,
        child_process: false,
        worker_threads: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
