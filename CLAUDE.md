# dylmusic — Project Context

**dylmusic** is Dyl's ("the OG crypto rapper") music-NFT platform — a Next.js 14
(App Router) app on Vercel. Browse a discography, buy/sell numbered track
editions (100 per track, per chain) via a real order-book (mint price OR
cheaper resale asks), stream real audio, swap any token cross-chain, and a
heavily Windows-95-themed "desktop" site shell (draggable file icons, a
persistent taskbar, Start Menu). Deployed at **dylmusic.vercel.app**.

---

## ⚠️ CONTRACT REQUIREMENT — READ BEFORE WRITING ANY NFT CONTRACT

**Every single Dyl NFT, across every track and every album, on a given chain,
must live on ONE contract.** This is non-negotiable and is the whole point of
the architecture: OpenSea (and any other marketplace) treats a contract
address as a collection. Splitting tracks/albums across multiple contracts
splits volume, floor price, and collection stats across multiple listings —
exactly what must NOT happen. All EVM volume for Dyl NFTs on a given chain
must consolidate into a single OpenSea collection page.

Concretely, when contracts get built:

- **EVM chains (Robinhood Chain, Base): one ERC-1155 contract per chain**,
  not one contract per track and not one contract per album. Each track is a
  distinct `tokenId` within that one contract; `editionCap` (100) is that
  token id's max supply; individual numbered editions are just sequential
  mints of that `tokenId` (ERC-1155 doesn't have "edition numbers" as a
  first-class concept the way ERC-721 serials do — decide before building
  whether "edition #14" is tracked via a separate on-chain counter/event log,
  or whether it's cosmetic-only in the UI while the contract just tracks
  aggregate supply per `tokenId`). New albums/tracks get NEW `tokenId`s
  minted on the SAME existing contract — never a new contract deployment
  per album. This is why the contract needs to be **upgradable** (see
  below) — adding tracks/albums over time is core to the roadmap
  (Internet Legend, lost angeles files, and whatever comes after), and the
  collection must never fragment across contract addresses to support that.
- **Solana: one Metaplex Certified Collection per... TBD whether "per chain"
  here just means Solana overall, or something finer.** Every minted edition
  NFT must be `verified` into that single Collection NFT so marketplaces
  (Magic Eden, OpenSea's Solana support, etc.) group them into one
  collection page. Do not mint uncollectioned/orphaned NFTs.
- **Base and Robinhood Chain are separate contracts from each other**
  (cross-chain, can't share one contract) — the single-collection rule
  applies **per chain**, not across all chains combined. So the real target
  is: exactly one EVM collection on Robinhood Chain, exactly one EVM
  collection on Base, exactly one Solana collection. Three collections
  total, not one-per-track (would be 19+ contracts) and not one shared
  contract across chains (impossible anyway — different VMs).

**Contracts must be upgradable** (proxy pattern — UUPS or Transparent Proxy
for EVM; Solana's own program-upgrade authority model for the Solana side).
Dyl's own wallet (see Admin below) should hold upgrade authority. This is
requested specifically so the catalog can grow (new tracks/albums = new
token ids/mints on the existing contract, plus any logic fixes) without ever
having to deploy a new contract address and fragment the collection.

**Nothing about this is built yet** — this section exists so a future
contract-writing session starts from the right architecture instead of
naively spinning up a contract per track. If any contract work begins,
re-read this section first and confirm the plan still satisfies "one
contract = one collection = all volume" before writing Solidity/Anchor.

---

## Current state: everything is a local simulated ledger

**No contracts are deployed anywhere yet.** Every "buy," "mint," "sell,"
"listing," and edition-ownership record lives in the connected browser's own
`localStorage` (`lib/holdings.ts`) — nothing is a real on-chain transaction,
and no real payment has ever been collected for an NFT. This was a
deliberate, explicit decision (confirmed multiple times with Dylan) to keep
the buy flow — including the "Pay With any token" cross-chain flow — fully
simulated until real contracts exist, specifically so the site never
collects real money for something that doesn't exist on any chain. Do not
wire real fund movement into the buy flow without an explicit, fresh
confirmation from Dylan — the last time this was raised he was clear:
"simulated. dont actually swap anything til we drop the real contracts."

The one genuinely real/server-side feature is **Member Chat** (Upstash
Redis-backed, `/chat`) — gated to wallets that show edition ownership in the
local ledger (self-reported, not on-chain verified, consistent with
everything else being pre-contract).

The **Swap page (`/swap`, "Dyl Swap")** is real and live — real Relay SDK
quotes/execution across Robinhood Chain, Base, and Solana (verified live,
including real cross-chain Base→Solana quotes). This is a genuine, working
utility independent of NFT buying — swapping your own tokens is not "buying
a Dyl NFT," so it was fine to make real from the start.

---

## Royalty — 6.9% on Dyl buy/sell, NOT settled yet

Dylan's stated target: **6.9% royalty on every buy/sell of a Dyl edition.**
Before writing this into any contract, resolve the real, industry-wide
problem this runs into — it is genuinely unsettled, not just an
implementation detail:

- **EVM royalties are not protocol-enforced.** ERC-2981 is an *informational*
  standard — a contract can declare "this sale owes 6.9% to this address,"
  but no EVM marketplace is required to honor it, and since the
  OpenSea/Blur royalty wars (~late 2022) most major marketplaces (OpenSea
  included, for most collections) treat creator royalties as **optional**,
  not enforced. Declaring a royalty in the contract does not make secondary
  sales actually pay it on a standard marketplace like OpenSea.
- **"Hardcoding" it only works in flows the app itself controls.** The one
  place a royalty (or a fee — same mechanism dylmusic's own Swap and
  HOODPrinter's own swap already use, `PAY_PORTION` skimmed atomically
  inside a single router transaction) can be truly guaranteed is a sale
  that routes through dylmusic's own order-book/buy-sell UI, where the app
  builds the transaction. It canNOT be guaranteed on a sale that happens
  directly through OpenSea's own listing/fulfillment flow, or any other
  third-party marketplace — the contract has no ability to force that.
- **On-chain transfer-enforcement exists but has real tradeoffs.** A
  contract *could* block/tax transfers unless a royalty payment
  accompanies them (Manifold's Royalty Registry, Sudoswap-style patterns,
  OpenSea's now-deprecated Operator Filter Registry, etc.), but this kind
  of enforcement can make a collection behave unexpectedly or fail to list
  cleanly on standard marketplace flows — a real cost, not a free win.
- **Solana is a different problem with different odds** — Metaplex
  supports enforced royalties more natively (rule sets / programmable
  NFTs), so 6.9% may be realistically enforceable there even where it
  isn't on EVM. Worth confirming which Metaplex mechanism before building.

**Not decided yet**: whether to (a) only guarantee 6.9% on sales through
dylmusic's own UI and accept it's unenforced elsewhere, (b) accept the
tradeoffs of on-chain transfer enforcement for guaranteed EVM royalties,
or (c) some hybrid. Resolve this explicitly with Dylan before writing
royalty logic into any contract — don't default to assuming ERC-2981 alone
"solves" it, since on most marketplaces today it does not.

---

## Admin — `/admin`

Wallet-gated (client-side check, not a signature — fine for today's low
stakes, **must move to real signature verification before anything that
moves funds or deploys/upgrades a real contract is wired up**). Admin wallet:
`0x9e0149f7CC28c93A3B5F76AB3e8A2a22d14435b5` (`lib/admin.ts`,
`ADMIN_WALLET`/`isAdminWallet()`). Currently has: platform status readout,
chat moderation (delete messages, server-side-checked against the same admin
wallet via `DELETE /api/chat`).

**To build**: contract deploy + upgrade tooling. Since contracts must be
upgradable (see above), this isn't a one-time "Deploy" button — it needs
distinct deploy (first time per chain) and upgrade (push new implementation
to the existing proxy) actions, plus whatever "add a new track/album as a
new tokenId on the existing collection" action looks like day-to-day. Design
this panel around the fact there are exactly 3 target collections total
(Robinhood Chain, Base, Solana) — not a generic "deploy any contract" tool.

---

## Dashboard — `/dashboard`

**NFT stats are the priority section and must be at the top; streaming
stats go below.** A "quick stats" row sits above both: total ETH volume
(click to toggle the same figure into SOL), total streams, plus other key
top-line numbers. This ordering is deliberate — Dyl explicitly called NFT
data "priority" over streaming data.

---

## Chains

`lib/albums.ts` `CHAINS` / `ChainKey = "robinhood" | "base" | "solana"`.
Real Robinhood Chain neon brand color is **`#CCFF00`** (verified by
sampling the actual official chain-icon asset pixel data — NOT `#00C805`,
which was wrong and used earlier before being corrected). `--accent` CSS
var follows whichever chain is selected site-wide.

## Deploy

**Deploys via the Vercel CLI (`npx vercel --prod --yes`), not git push** —
this repo has **no git remote configured** (`.vercel/project.json` links it
to the `dylmusic` Vercel project directly). Always run a real build
(`export PATH="/usr/local/opt/node@20/bin:$PATH"; npm run build`) and check
exit code before deploying. Node 20 required (repo default may be older).

## Verifying UI changes

Use CDP device emulation for real screenshots (`--screenshot` headless flag
is misleading, renders ~800px regardless of window size). Kill any stale
`next start` server by PID before restarting for QA — `pkill -f "next
start"` does NOT match the actual process name (`next-server`), so a stale
server can silently keep serving old code on the same port while a restart
attempt fails with `EADDRINUSE` in the background. Confirm the listener PID
via `lsof -iTCP:<port> -sTCP:LISTEN` after every restart before trusting a
screenshot.
