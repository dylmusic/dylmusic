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

## Legacy contracts — eligible for "burn old NFTs, get free mints"

Dylan's own words, now live as one of the AIM-style message bubbles on the
homepage: *"if you had any of my old NFTs, burn them and get free mints."*
**The burn-to-mint mechanism itself is not built yet** — this is just the
real, as-given contract list to build it against once it is. Addresses are
recorded exactly as Dylan supplied them, not independently verified
on-chain yet — verify each one for real (bytecode, `name()`/`symbol()`,
actual holder data) before writing any burn-eligibility logic against them.

**Old Dyl NFT collection (Ethereum mainnet)**
- `0x253bfce1757bb2e5f9159738f8309c73dafe09ea`

**Old Dyl NFT collection (Solana) — "Crypto Rich Deluxe Trading Cards"**,
listed at magiceden.us/marketplace/crypto_rich_deluxe_trading_cards.
Magic Eden's own public API was hard-rate-limited when this was looked up
(so this was NOT confirmed via their `/v2/collections/...` endpoint) —
instead pulled directly from JSON embedded in the marketplace page's own
initial state, which explicitly ties this address to
`"symbol":"crypto_rich_deluxe_trading_cards","name":"Dyl"`:
- **Candy Machine ID: `7JvmupdkaFekk2bqqesk4Y22ejQhmpC8Gx5AkB3usgPw`** — this
  is the real collection identifier for this Candy-Machine-era Solana drop.
  No separate Metaplex Certified Collection mint was found in the page data
  looked at (that field may not exist for a collection this old, or may
  just not have been present in the specific payload fetched) — if a
  distinct `collection.key` shows up when this is actually built against,
  that's the more precise per-NFT-verifiable address; the candy machine ID
  is what's confirmed for now.
  - One live example token from this collection (the current floor NFT at
    the time this was looked up, for spot-checking against a real wallet
    on Solscan/Solana FM): mint `3r7CWTme5bM4nNwHk9GRjygBBS2i5n5R3CQV4GvwQwsu`.
  - Dylan's own wallet was checked directly against Solana's mainnet RPC
    (not a marketplace/indexer UI, which turned out to be unreliable —
    see below): `7pJuy6qEznjGP1uxoApzbsHZq33e4RANF8AbZPGQ9jxy` currently
    holds exactly one NFT-shaped token, and it isn't this collection — it's
    a **"Mortuary Inc. Ashes" ($ASH)** token, strongly suggesting the real
    card was burned via some NFT-incinerator-style service at some point
    (those typically mint a symbolic "ashes" receipt token). Magic Eden's
    UI still shows this wallet as an owner regardless — confirmed that's
    just their indexer/cache being stale (they don't re-crawl old,
    low-volume collections often), not live on-chain truth. **Lesson for
    building the real burn-mint feature: verify holdings via a live RPC
    call (`getTokenAccountsByOwner` + Metaplex metadata PDA), never by
    trusting Magic Eden's or Solscan's cached ownership display.**
  - A second Solscan link Dylan supplied that reliably navigates to (what
    is likely) this same collection, id not independently confirmed as a
    real on-chain address (could just be Solscan's own internal grouping
    id, not a mint/authority/candy-machine address):
    `solscan.io/collection/874220bb58df72243a7a0bc29821c56521098e6b9f4dd1bcc0fdad434732541b`.
    Solscan's site sits behind a Cloudflare managed challenge that blocked
    every fetch method tried in this session (plain curl, WebFetch, and a
    real headless Chrome instance all hit "Just a moment..." — actively
    detecting automation, not a simple JS-wait). Before building
    burn-eligibility logic, resolve this link to the real on-chain
    identifier (candy machine id / update authority / collection mint) —
    easiest path is just having Dylan open it himself and read off
    whatever address Solscan displays there, since this environment can't
    load the page.

**$DYL (old cross-chain token) — burning the coin itself may or may not be
in scope of "old NFTs"; listed here since Dylan supplied it in the same
message. Confirm with him whether $DYL burns also grant mints, or only the
old NFT collection does.**
- Ethereum: `0x7a8946EDA77817126ffE301249f6DC4C7Df293C3`
- Polygon: `0x4A506181f07Da5ddFDA4ca4c2Fa4c67001dB94B4`
- Base: `0x4A506181f07Da5ddFDA4ca4c2Fa4c67001dB94B4` (same address as
  Polygon — plausible via a deterministic CREATE2 deploy, not re-verified)
- Solana: `DTUW2CFo71KnTNSFYX95jQ8P8aJVQVr8MEF1AGMm5WGm`

**Old Dyl NFT collection (Tezos)** — `KT1EcBQkN7vuVxg3gDZBbVb7qnBD6kDdS14K`.
Verified for real via TzKT's public API (`api.tzkt.io`, no auth/rate-limit
trouble unlike Solscan/Magic Eden): a real FA2 contract, `metadata.name:
"Dyl"`, `description: "Dyl . Music NFTs . itslit.org/nft . @famous_dyl"`,
minted through objkt.com's minting factory, 69 tokens total (only 2 showing
an active/nonzero holder balance right now via TzKT's own indexing — most
of the edition likely already burned/dispersed, same pattern as the Solana
collection). Sold/listed on **objkt.com** (Tezos' primary NFT marketplace,
equivalent role to Magic Eden/OpenSea).

**New requirement this adds: Tezos wallet support.** Burn-to-mint
eligibility checking for this collection means the site needs to support
connecting a Tezos wallet — **Temple Wallet** (the standard Tezos browser
extension, plays the role RainbowKit/MetaMask play for EVM) and **Trust
Wallet** (multi-chain, has Tezos support). This is a real third wallet
stack beyond the existing EVM (wagmi/RainbowKit) and Solana (Phantom via
`window.solana`) connections — Tezos wallet connections go through the
Beacon SDK (`@airgap/beacon-sdk`) with Taquito for the actual chain calls,
neither of which exist in this codebase yet. Scope this as its own real
integration when the burn-to-mint feature actually gets built, not a
drop-in extra chain on the existing EVM/Solana wiring.

Open questions to resolve before building this (don't guess): does
"burning" mean sending to a dead/burn address on the ORIGINAL chain the old
asset lives on (Ethereum/Polygon for the old contracts, separate from
wherever the new Dyl collections end up per the single-collection mandate
above), and does the free mint land on whichever NEW chain the user
chooses, or a fixed mapping? How is burn eligibility checked cross-chain
(e.g., burning an old Solana $DYL token to claim a free mint on the new
Base collection) — this needs real cross-chain proof-of-burn verification,
not just a client-side self-report like the rest of this app's current
"ownership" checks.

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

## Deployment minting strategy — editions #1–10 pre-minted, priced by rarity

Dylan's plan, to be part of the deploy flow for every track (not built
yet): **auto-mint editions #1 through #10 to Dylan's own wallet at deploy
time**, then **auto-list them on secondary at an inverse price scale** —
the lower the edition number, the higher the price:

| Edition # | List price |
|-----------|-----------|
| 10        | $10       |
| 9         | $20       |
| 8         | $30       |
| 7         | $40       |
| 6         | $50       |
| 5         | $60       |
| 4         | $70       |
| 3         | $80       |
| 2         | $90       |
| 1         | $100      |

(pattern: price = `(11 − editionNumber) × $10`)

**Public/site minting for that track then starts at edition #11**, at the
normal flat mint price ($0.99). Editions 1–10 are never available at the
base mint price to the public — they're pre-claimed by Dylan and only
reachable via secondary purchase at the scaled price above.

Open items for whoever builds this:
- Confirm this applies to **every track** (assumed default — Dylan didn't
  carve out exceptions) or only specific ones.
- "Auto-list on secondary" needs a real target: dylmusic's own order book
  (already built, trivial to seed) is the easy part; if the intent is
  also listing on **OpenSea** itself (the actual target marketplace per
  the single-collection mandate above), that needs either manual listing
  through OpenSea's own UI (10 clicks × however many tracks, no code
  required) or real Seaport protocol integration to automate it — decide
  which before assuming "auto-list" means both.
- This needs to be a scripted step in the deploy/init flow (mint N editions
  to a specific address, then create N listings at specific prices) — not
  something done by hand per track after the fact, given the catalog will
  keep growing per the upgradability requirement above.

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
