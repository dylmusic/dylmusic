/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Confirmed live (curl -I against nft.dylmusic.com) that every /public
  // static asset — including 1.5-2.5MB audio files and up to 4MB cover
  // images — was serving `Cache-Control: public, max-age=0, must-revalidate`
  // with `X-Vercel-Cache: MISS`, Next's own default for un-hashed public
  // files (unlike /_next/static/*, which IS content-hashed and
  // auto-immutable). That means every single request for these — from any
  // visitor, not just repeats — was a full uncached origin hit, the
  // largest per-request payloads on the whole site. These directories are
  // genuinely static (real, already-mastered/uploaded files, never edited
  // in place — a content change ships as a new file), so a real cache is
  // safe. Not `immutable`/a full year on purpose: `/public` files keep the
  // same URL across deploys (unlike hashed build assets), so a week-long
  // cache + a month of stale-while-revalidate meaningfully fixes the
  // max-age=0 problem while still letting a same-filename content swap
  // propagate within days, not silently staying stale for a year.
  async headers() {
    const cache = { key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" };
    return [
      { source: "/audio/:path*", headers: [cache] },
      { source: "/covers/:path*", headers: [cache] },
      { source: "/brand/:path*", headers: [cache] },
      { source: "/fonts/:path*", headers: [cache] },
      { source: "/memes/:path*", headers: [cache] },
    ];
  },
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
