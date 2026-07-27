/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // wagmi/connectors pulls in a Coinbase "Base Account" connector we don't
    // use, which statically imports @x402's optional payment modules that
    // aren't installed. Safe to stub out; nothing reaches them.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/evm": false,
      "@x402/evm/upto/client": false,
      "@x402/evm/exact/client": false,
      "@x402/core/client": false,
      "@x402/svm/exact/client": false,
    };
    return config;
  },
};

export default nextConfig;
