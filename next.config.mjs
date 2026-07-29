/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { webpack }) => {
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
    // @opensea/sdk (lib/openSeaListing.ts) uses Node's built-in
    // EventEmitter via the "node:events" specifier. Webpack 5's browser
    // build treats "node:" as an unhandled URI SCHEME (a plain
    // resolve.alias entry doesn't intercept scheme-prefixed requests, only
    // normal module resolution) — NormalModuleReplacementPlugin strips the
    // "node:" prefix first so it resolves as a bare "events" specifier,
    // which then falls through to the "events" npm package (already
    // present as a transitive dep, the standard browser shim for it).
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
        resource.request = resource.request.replace(/^node:/, "");
      })
    );
    return config;
  },
};

export default nextConfig;
