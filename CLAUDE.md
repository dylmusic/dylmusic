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

- **EVM chains (Robinhood Chain, Base, Ethereum): one ERC721A contract per chain**,
  not one contract per track and not one contract per album, and **not
  ERC-1155** (decided against 2026-07-28, see below). Each edition is a
  real, unique ERC-721 token id — not a fungible copy count under a shared
  track id — which is the whole reason for the switch: buyers/marketplaces
  treat 721s as genuinely unique collectibles, 1155s read as generic
  fungible-stock items. Token ids are partitioned into per-track ranges
  (e.g. track N occupies ids `N*1000` through `N*1000+99` for its 100
  editions) so "edition #14 of track X" is one specific, unique token id —
  decide the exact offset scheme before building, it just needs to be
  fixed and collision-free across every track ever added. New
  albums/tracks get a NEW range of ids minted on the SAME existing
  contract — never a new contract deployment per album. This is why the
  contract needs to be **upgradable** (see below) — adding tracks/albums
  over time is core to the roadmap (Internet Legend, lost angeles files,
  and whatever comes after), and the collection must never fragment
  across contract addresses to support that. ERC721A's batch-mint gas
  savings apply whenever multiple editions of a track mint together
  (e.g. an admin/team allocation, or a buyer grabbing several editions in
  one tx) — even if most public mints are one edition at a time, it costs
  nothing to build on ERC721A and it is the standard the rest of this
  section assumes.
- **Solana: one Metaplex Certified Collection per... TBD whether "per chain"
  here just means Solana overall, or something finer.** Every minted edition
  NFT must be `verified` into that single Collection NFT so marketplaces
  (Magic Eden, OpenSea's Solana support, etc.) group them into one
  collection page. Do not mint uncollectioned/orphaned NFTs.
- **Every EVM chain is a separate contract from every other one**
  (cross-chain, can't share one contract) — the single-collection rule
  applies **per chain**, not across all chains combined. So the real target
  is: exactly one EVM collection each on Robinhood Chain, Base, and
  Ethereum, plus exactly one Solana collection. Four collections total
  (Ethereum added 2026-07-28, gas cheap enough now to be worth it — see
  lib/albums.ts CHAINS), not one-per-track (would be 19+ contracts) and
  not one shared contract across chains (impossible anyway — different
  VMs).

**Decided 2026-07-28: ERC721A, not ERC-1155, for the EVM contracts.**
Dylan on 2026-07-27: "i think we should do ERC721A" (flagged as an
explore-later tension against the then-current ERC-1155 plan); on
2026-07-28, corrected firmly and decided outright: "we do NOT like
erc1155. that was the old way, really bad. ERC721A is the right way
because everyone likes unique 721s. 1155s are trash." This is now the
standing requirement — the bullet above reflects it. Do not build an
ERC-1155 version of these contracts.

**ERC721A specifics, confirmed research (Dylan supplied 2026-07-28,
matches how Azuki's actual implementation works) — read before building:**
- **Standard ERC-721 has no batch-mint function at all** — that has to be
  a feature of the specific contract. ERC721A adds a `mint(quantity)` that
  compresses ownership storage across a consecutive run, making each
  additional token in the same transaction to the same wallet
  meaningfully cheaper than a separate mint call would be. The savings
  come specifically from **consecutive tokens minted to the SAME address
  in ONE transaction** — this is exactly the "buyer grabbing several
  editions in one tx" case already called out above, and exactly the
  multi-buy feature already shipped in `lib/useTrackCommerce.ts`
  (`mintTrack(t, quantity)`, the order-book quantity stepper) for the
  *simulated* buy flow — when the real contract exists, that function is
  the natural place to call a real `mint(quantity)` instead of looping N
  separate single mints.
- **ERC721A is a gas-optimized implementation of ERC-721, not a different
  standard** — fully compatible with every normal wallet/marketplace/
  ERC-721 tool. Every minted token is still fully separate afterward:
  its own unique tokenId, its own metadata, individually transferable/
  approvable, shows up on OpenSea etc. exactly like a normal 721. This
  directly confirms the per-track tokenId-range partitioning scheme two
  bullets up is sound — batch-minting a run of ids under ERC721A doesn't
  change that each one is a real independent token afterward.
- **ERC721A does NOT include ERC721Enumerable** (the optional extension
  for "list every token a wallet owns" / "list every token that
  exists"). Marketplaces don't need it — they index `Transfer` events
  instead — but **this site's own code will**, the exact same way
  `lib/solanaCollectionCheck.ts` and the Ethereum legacy-collection
  enumeration gap already documented under "Credits system" above hit
  this same wall for a pre-existing collection with no enumeration
  support. Do not repeat that gap on a NEW contract we control: either
  add a custom view function (e.g. a per-owner token list, or at least a
  per-owner-per-track balance) at build time, or plan on an indexer
  (Alchemy — an API key is already stored as `ALCHEMY_API_KEY` in Vercel
  production env, added 2026-07-28 for exactly this class of problem)
  from day one rather than discovering the gap after deploy.
- **Batch savings apply best to "mint N to one wallet in one tx"**, less
  to airdrops/mints spread across many different wallets (a custom
  airdrop function still beats N separate transactions on overhead, just
  not by as much), and OpenZeppelin's `ERC721Consecutive` (a different,
  even-cheaper batch primitive) only works at contract *construction*
  time, not for after-deploy public minting — not applicable here since
  editions mint over time as tracks/albums are added, not all at once at
  deploy.

**Contracts must be upgradable** (proxy pattern — UUPS or Transparent Proxy
for EVM; Solana's own program-upgrade authority model for the Solana side).
Dyl's own wallet (see Admin below) should hold upgrade authority. This is
requested specifically so the catalog can grow (new tracks/albums = new
token ids/mints on the existing contract, plus any logic fixes) without ever
having to deploy a new contract address and fragment the collection.

**What actually makes OpenSea (and Magic Eden for Solana) pick a
collection up correctly — Dylan asked directly 2026-07-28, checklist for
whoever writes the contracts:**
- **EVM, required for OpenSea to render it at all:**
  `supportsInterface` must correctly report ERC-721 (`0x80ac58cd`) — this
  comes for free from any real ERC721A base, just don't break it.
  `tokenURI(tokenId)` must return real metadata JSON (`name`,
  `description`, `image`, `attributes`) — OpenSea refuses to display an
  item with a broken/empty `tokenURI`.
- **`contractURI()`** — not part of the ERC-721 standard itself, but an
  OpenSea-specific convention (also adopted by most other EVM
  marketplaces) for the *collection-level* page: name, description,
  image, banner image, external link, and (historically) a
  `seller_fee_basis_points`/`fee_recipient` pair for royalties. Without
  this, items can still show up individually but the collection page
  itself (banner, description, verified-looking presentation) will be
  blank/wrong. Add it.
- **ERC-2981 (`royaltyInfo()`)** — the on-chain royalty-signaling
  standard. OpenSea does read this now (post royalty-wars), but see the
  "Royalty — 6.9%" section below: reading it is not the same as any
  marketplace being forced to pay it. Implement it anyway since it costs
  nothing and is what OpenSea and most others actually check first, but
  don't treat it as a guarantee.
- **Chain support is still the one unverified precondition** — none of
  the above matters if OpenSea doesn't index Robinhood Chain at all (see
  the "yes, but it doesn't do what you'd expect" section right below,
  already flags this as unverified). Confirm this before relying on
  OpenSea for that chain specifically.
- **Solana (Magic Eden is the real target there, not OpenSea — OpenSea's
  own Solana support has always been secondary/limited) — mirrors what
  the burn-checker verification already leans on**: real Metaplex Token
  Metadata per mint (`name`, `symbol`, `uri` → real off-chain JSON,
  `sellerFeeBasisPoints` for royalty display), and every edition
  `verified` into the one Certified Collection NFT per the requirement
  above — an unverified/orphaned mint will not group into the collection
  page on Magic Eden or anywhere else. **Worth deciding explicitly**:
  legacy (plain) Metaplex NFTs have royalties as an honor-system
  suggestion just like EVM's ERC-2981, but Metaplex's newer
  **Programmable NFT (pNFT)** standard can actually enforce
  royalties at the protocol level via rule sets — the one real lever
  Solana has that EVM doesn't for the unresolved 6.9%-royalty question
  below. Not decided which to use yet; pNFTs are more restrictive
  (transfer rules can block marketplaces that don't cooperate) so weigh
  that against the enforcement benefit before picking.
- **Metadata mutability** — OpenSea/Magic Eden both surface a warning
  (sometimes to buyers directly) when a collection's metadata is
  "unverified" or freezable/mutable by the creator. Decide and document
  whether metadata is frozen/immutable after mint or intentionally
  upgradable (leans toward upgradable here, given the "add tracks/albums
  over time" requirement above uses an upgradable proxy already) — just
  don't let this be an accidental default either way.
- **None of the above is a substitute for OpenSea's own manual
  collection verification** (the checkmark) — that is a social/support-
  ticket process on their end, not something the contract can do.

**Nothing about this is built yet** — this section exists so a future
contract-writing session starts from the right architecture instead of
naively spinning up a contract per track. If any contract work begins,
re-read this section first and confirm the plan still satisfies "one
contract = one collection = all volume" before writing Solidity/Anchor.

---

## "Our own marketplace contract" — yes, but it doesn't do what you'd expect on OpenSea

Dylan's question: can dylmusic have its own way of listing editions that
also shows up on OpenSea, via "our own market contract"? Two different
things get conflated here, worth being precise about before building:

- **A standard ERC-721/1155 NFT's current owner and full transfer history
  shows up on OpenSea's item page automatically**, no matter which
  contract mediated a transfer — dylmusic's own buy/sell order-book
  contract (this part genuinely is easy — the site's current *simulated*
  order-book already mirrors exactly this pattern) would move real
  ownership via standard `Transfer` events, and OpenSea's own indexer
  picks that up regardless of not being "their" sale. So: real mints/sales
  through our own contract WILL correctly show real owners/history on
  OpenSea.
- **What does NOT happen automatically: an item showing up as "for sale,
  Buy Now" inside OpenSea's own marketplace UI.** That specifically
  requires a real **Seaport** order (OpenSea's own listing protocol) to
  exist — a listing made through our own separate marketplace contract is
  invisible to OpenSea's own buy UI unless we *also* create a matching
  Seaport order (via OpenSea's API/SDK) or a user lists manually through
  opensea.io themselves. "Our own market contract" and "listed for sale on
  OpenSea" are two different, both-buildable, NOT-automatically-linked
  things — don't assume building the first gets you the second for free.
- **Unverified, worth confirming before relying on it**: does OpenSea even
  index/support **Robinhood Chain**? Confirmed working for Ethereum and
  Base; Robinhood Chain is small/new enough that this hasn't been checked.
  If OpenSea doesn't support that chain at all, the entire "single
  OpenSea collection" mandate above needs a fallback plan for Robinhood
  Chain specifically (e.g. relying on Robinhood's own chain explorer/
  marketplace instead, if one exists) — verify this before it matters.

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
- `0x253bfce1757bb2e5f9159738f8309c73dafe09ea`. Verified live via RPC:
  `name()`/`symbol()` = `"Dyl"`/`"Dyl"`, `totalSupply()` = 2227.
  **This single contract mixes several distinct item types under one
  `totalSupply` — NOT all 2227 tokens are trading cards.** Confirmed by
  reading real `tokenURI`s + IPFS metadata across a spread of ~40 token
  ids (0 through 2226): the on-chain `name`/`attributes` distinguish them
  cleanly, no guessing needed.
  - id `0`: `"Dyl"` PFP, `Edition: PFP`, `Rarity: 1/1` — a single 1-of-1,
    not a card.
  - ids ~`1`–`219`: `"Crypto Rich Deluxe"` album-cover VIP editions,
    `Edition: Deluxe`, `Rarity: 1/200` — not cards.
  - ids ~`220`–`239`: one-off song covers like `"Treat Myself"`
    (`Edition: Single`, `Rarity: 1/1`) — not cards.
  - ids ~`240`–`359`: **`"Crypto Rich Deluxe Trading Card (Gold)"`** —
    `Edition: Gold`, `Rarity: 1/100`. This IS a trading card, Gold tier.
  - ids ~`360`–`1349`: **`"Crypto Rich Deluxe Trading Card (Standard)"`**
    — `Edition: Standard`, `Rarity: 1/1000`. Trading card, Standard tier.
  - ids ~`1350`–`2149` (~800 tokens, a big chunk): **`"Mystery Trading
    Card"`** — pre-reveal placeholder metadata only (`"Pre-Reveal. What
    Will You Get?"`), no `attributes`/tier yet. These tokens' real tier
    (Gold/Standard/other) is genuinely unknown until/unless the project
    ever reveals them — can't be determined from current metadata.
  - ids ~`2150`–`2226`: **`"Crypto Rich Trading Card (Standard)"`** (the
    non-Deluxe album) — `Edition: Standard`, `Rarity: 1/1000`.
  - **No "Platinum" tier was found anywhere** across this full sample —
    only Gold and Standard appeared among revealed cards.
  - **How to distinguish programmatically**: read `tokenURI(id)` →
    fetch the JSON → check `name` for the substring `"Trading Card"` to
    know if it's a card at all, then read `attributes[].trait_type ===
    "Edition"` for the tier (`"Gold"` / `"Standard"`) — do NOT rely on
    fixed id ranges as authoritative, the boundaries above are from
    sampling, not an exhaustive per-token scan.

**A second, separate Dyl-owned ERC-721 (Ethereum)** —
`0x6764aE7179342134Dfe263C59A077E40d25f2B95`. Verified live via a public
Ethereum RPC (`ethereum-rpc.publicnode.com`, `viem`, no API key needed):
real deployed contract, `name()`/`symbol()` both return `"Dyl"`,
`totalSupply()` = 1333, `supportsInterface(0x80ac58cd)` (ERC-721) = true,
real IPFS `tokenURI`. `ownerOf(1)` currently returns Dylan's own admin
wallet (`0x9e0149f7CC28c93A3B5F76AB3e8A2a22d14435b5`) — confirms this is
genuinely his. Dylan called this "a token" when he supplied it, but it's
an NFT collection (ERC-721), not fungible — don't build burn logic
assuming ERC-20 semantics here.

**Four specific Dyl items on OpenSea's own Shared Storefront contract**
(`0x495f947276749Ce646f68AC8c248420045cb7b5e` — verified via RPC:
`name()` = `"OpenSea Shared Storefront"`, `supportsInterface(0xd9b67a26)`
(ERC-1155) = true). **This is OpenSea's generic multi-tenant contract used
by thousands of unrelated creators for lazy-minted items — burn-eligibility
logic here MUST check the exact `(contract, tokenId)` pair, never "does
this wallet hold anything from this contract."** The 4 real, verified
token ids (all confirmed via a working `uri()` call):
  - `71467707431311496150712806865917248713642172373080555837822809033127644627944`
  - `71467707431311496150712806865917248713642172373080555837822809030928621371492`
  - `71467707431311496150712806865917248713642172373080555837822809034227156254820`
  - `71467707431311496150712806865917248713642172373080555837822809021033016721418`

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

### Burn protocol — which address/mechanism per chain

Dylan's direction: use a real, recognizable, "looks legit" burn address per
chain rather than inventing one. Verified for real before writing anything
here (getting a burn address wrong is unrecoverable — a bad address either
just isn't a real burn, or worse, sends a real asset to whoever actually
controls it):

- **EVM (Ethereum, Base, Polygon, Robinhood Chain): `0x000000000000000000000000000000000000dEaD`**
  — verified live: valid checksum, zero outgoing transactions ever (exactly
  what a real dead address should look like — it only ever receives). This
  is the industry-standard "burn address" convention across the whole EVM
  ecosystem, deliberately not the true zero address (`0x000...000`) since
  some tokens' `transfer()` reverts on sends to the zero address, and
  `0x...dEaD` reads as obviously intentional.
- **Tezos: `tz1burnburnburnburnburnburnburjAYjjX`** — verified live via
  TzKT (`api.tzkt.io`): TzKT's own indexer labels this address itself
  `"alias": "Burn Address 🔥"`, holding 727,301+ distinct tokens across
  728,494+ token balances. Real, ecosystem-recognized, not a guess.
- **Solana: there is no equivalent "send it to a dead address" convention
  to verify, and none should be used.** SPL Token (the standard both
  fungible $DYL and the Crypto Rich Deluxe Trading Cards NFTs use) has a
  **native `Burn` instruction** that actually decrements supply and
  destroys the token at the protocol level — this is the technically
  correct mechanism, not a wallet-style black-hole address. (This is also
  exactly why burning on Solana can reclaim SOL rent and EVM burns can't —
  a real burn + closing the token account returns the rent deposit; a
  same-chain EVM "burn" is just a transfer with no analogous refund.) A
  specific "incinerator" vanity address was floated but **could not be
  verified — every guessed variant failed as an invalid/wrong-size Solana
  pubkey against a live RPC call, so none is recorded here.** Don't use an
  unverified address; call the real `Burn`/`BurnChecked` instruction from
  `@solana/spl-token` instead when this gets built.

### Full rarity/tier structure, per chain (Dylan-supplied 2026-07-27 — ground
truth for reward design, only partially independently verified so far)

Dylan supplied this breakdown directly as the real, intended rarity system
across every chain. Where noted, pieces of it match what was independently
verified via live `tokenURI` reads on `0x253bfce1757bb2e5f9159738f8309c73dafe09ea`
above; the rest is recorded as-given, not yet re-derived from raw contract/API
data — verify further before hardcoding any of it into eligibility logic.

- **Ethereum — 2,442 NFTs total** ("Main Chain. Most History. VIPs."):
  - **VIP NFTs — 221**: `1/200` Deluxe VIP, `1/10` Classic Rare VIP, `1/1`
    Singles Very Rare VIP. (Matches what was independently found: the
    `"Crypto Rich Deluxe"` album-cover batch at `Rarity: 1/200` and one-off
    songs like `"Treat Myself"` at `Rarity: 1/1` — both verified live above.)
  - **Deluxe Trading Cards — 1,111**: `1/1000` Standard/Common, `1/100`
    Gold/Rare, `1/10` Platinum/Very Rare, `1/1` Diamond/Extremely Rare VIP.
    Note 1000+100+10+1 = 1111 exactly — the tier counts ARE the total.
    Standard and Gold were independently confirmed live in real metadata
    (`Edition: "Standard"`/`"Gold"`); Platinum and Diamond exist per this
    tier math but weren't hit by the (sparse, ~40-id) sample taken so far —
    at only 10 and 1 tokens respectively out of 1,111, that's expected, not
    a contradiction. A denser scan of the ~240–1349 id range would find
    them before building real eligibility logic.
  - **Classic Trading Cards — 1,111**: identical 4-tier structure
    (Standard/Gold/Platinum/Diamond, same rarity denominators) for the
    non-Deluxe "Crypto Rich" (Classic) album. The `"Crypto Rich Trading
    Card (Standard)"` batch at ids ~2150–2226 verified live above is this
    category's tail end.
- **Solana — 1,111 NFTs total** ("First Music NFT on MagicEden Launchpad"):
  **Deluxe Trading Cards only**, same 4-tier structure as Ethereum's Deluxe
  cards (Standard 1/1000, Gold 1/100, Platinum 1/10, Diamond 1/1). This is
  the "Crypto Rich Deluxe Trading Cards" collection already in
  `lib/legacyCollections.ts` (Candy Machine ID
  `7JvmupdkaFekk2bqqesk4Y22ejQhmpC8Gx5AkB3usgPw`).
- **Tezos — 4,836 NFTs total** ("Top Music NFT Collection on Tezos by
  Volume"), all under the objkt collection `KT1EcBQkN7vuVxg3gDZBbVb7qnBD6kDdS14K`:
  Crypto Rich Deluxe (1,331 — 19 songs × 69 editions each), Crypto Rich
  Classic (621 — 9 songs × 69 editions each), `gm` (420 — singles, 69
  editions each). **No trading-card tier system on Tezos** — flat per-song
  edition counts instead.
- **Polygon — 475 NFTs total, current collection DEPRECATED**: minted via
  MintSongs (`1/25 × 19 songs` = 475), a third-party platform that "went
  out of business" in 2022 — explicitly not Dylan's fault, just a dead
  platform. A brand-new Polygon collection is planned for existing Polygon
  collectors; a second, distinct set — "Crypto Rich Deluxe Trading Cards"
  on **ProtonMint** — was also mentioned as existing/planned but not yet
  detailed (no contract address supplied yet for either).

**Burn → free-mint reward ratio (Dylan-supplied 2026-07-27, superseding an
earlier draft of these numbers given moments before — use ONLY the table
below, the initial 3/5/7 figures were revised before anything was built
against them):**

| Chain  | Asset burned              | Free mints |
|--------|----------------------------|-----------:|
| ETH    | Standard trading card      | 5          |
| ETH    | Gold trading card          | 10         |
| ETH    | Platinum trading card      | 20         |
| ETH    | VIP NFT (the `1/200` tier) | 50         |
| Solana | Standard trading card      | 5          |
| Solana | Gold trading card          | 10         |
| Solana | Platinum trading card      | 20         |
| Tezos  | any 1 NFT                  | 1          |
| —      | 1,000,000 total $DYL held  | 5          |
| —      | 10,000,000 total $DYL held | 50         |

**Still open / not yet specified**: Diamond tier's reward (ETH or Solana),
whether Deluxe vs. Classic trading cards get the same ratio (recorded above
as if they do — not confirmed), Polygon's ratio, and the other two ETH VIP
sub-tiers (`1/10` Classic, `1/1` Singles).

**Resolved 2026-07-28: $DYL is burned, not just held.** The distinction
flagged above was asked directly — Dylan: "yes, you burn it, that
threshold shows how many free mints its worth after burning." So the
existing table's two rows (1,000,000 → 5, 10,000,000 → 50) are burn
thresholds: a real transfer of that much $DYL to the chain's burn
address is what has to happen on-chain, not a balance snapshot. Same
numbers, different (and now irreversible) mechanic — see the pipeline
section right below for how this fits with the NFT burns.

### Credits system + mint allocator (`lib/burnCredits.ts`, `components/BurnWalletChecker.tsx`) — shipped 2026-07-27

The reward table above is now wired into the live ETH wallet checker on
`/burn`, plus a "plan how to spend it" allocator. Real constraint hit while
building this: **there's no cheap way to know which specific tokenIds a
wallet holds in the tiered "Old Dyl NFT collection"
(`0x253bfce1757bb2e5f9159738f8309c73dafe09ea`) from a public RPC** — a live
`eth_getLogs` call for that contract's full Transfer history was tried and
rejected by `ethereum-rpc.publicnode.com` (public nodes cap the block
range), so there's no cheap way to enumerate a wallet's exact held
tokenIds and look up each one's real tier. Rather than fabricate a single
precise-looking number, the checker shows a **min–max range** for that one
collection (min = every held item priced as Standard/5, max = every item
priced as VIP/50) and uses the **conservative min** as the actual
spendable total — so the allocator can never let someone plan against
credits they might not really have. Real per-token enumeration (an
indexer/Etherscan-style API, or a self-hosted archive node) is the next
step if exact tiers matter later. The second ERC-721
(`0x6764aE...`) and the 4 OpenSea Shared Storefront items have no reward
value from Dylan at all yet — shown in the breakdown as held but "Not
priced yet," contributing 0 to the total rather than guessing. $DYL
(Ethereum) is exact (real `balanceOf`/`decimals` read, real threshold
math) since it's a simple balance check, not a tier lookup.

**Allocator**: once a spendable total exists, "Plan how to spend it" reveals
3 chain rows (Robinhood/Base/Solana — Robinhood Chain has no reward-table
entry of its own since it's the live chain, not a legacy one) with +/−
steppers, defaulting to an even split (remainder distributed to the first
chains). Purely local UI state — **nothing is submitted anywhere**, no
API call, no on-chain action; real burning still isn't wired up (see the
"Burning isn't wired up yet" notice already on the page).

### Full burn → mint pipeline — scoped 2026-07-28, NOT built beyond the numbered `/burn` UI

Dylan laid out the full intended system directly. `/burn` was restructured
the same day into 4 numbered steps matching this exactly (Check NFTs →
Burn NFTs → Choose how to spend it → Mint), but steps 2 and 4 are honest
disabled placeholders — **no real burn or mint transaction exists yet,
and per Dylan's own instruction none should be wired live until the
pieces below are actually ready**: *"do not actually burn anything or
credit anything yet, just set it up to be wired to real burn and real
contracts."*

- **Step 1 — Check NFTs**: already real (the 3 checkers above).
- **Step 2 — Burn NFTs**: one button per chain grouping (EVM/Solana/
  Tezos, matching the checkers' own grouping), each burning everything
  found for that chain — NFTs **and now $DYL** (see the resolved note
  above) — in one guided multi-signature flow, then flipping to
  "Burned ✓ Tx: 0x1234…" in place of the button. **For any multi-
  transaction flow here, reuse the exact HOODPrinter pattern already
  proven on `hoodprinter.xyz/swap`**: grey out / blur the whole module
  with an absolute-positioned overlay, a spinning ring, and step text
  ("Confirming 1/2", then "2/2") — don't invent a different multi-tx UX.
  Burn destinations (already verified live, see "Burn protocol" above):
  EVM → `0x000...dEaD` (NFTs via `safeTransferFrom`, $DYL via a normal
  ERC-20 `transfer`), Tezos → `tz1burnburnburnburnburnburnburjAYjjX`
  (FA2 transfer), Solana → the real `Burn` instruction from
  `@solana/spl-token` (protocol-level, no destination address).
  **Blocked on**: exact tokenId enumeration for the tiered Ethereum
  "Old Dyl NFT collection" (`0x253bfce1...`) — the checker only has a
  min–max range today because a public RPC can't page that contract's
  full Transfer history (see "Credits system" above). Dylan's call:
  *"Get an indexer API key"* — next concrete step is Dylan signing up
  for a free Alchemy (or Etherscan) API key, adding it as a Vercel env
  var, and handing it over so real per-tokenId enumeration (and
  therefore a real, precise burn) can be built. Nothing in step 2 should
  go live before that key exists — burning the wrong/an unverified set
  of tokenIds is not recoverable.
- **Step 3 — Choose how to spend it**: mostly real already (the
  allocator). The one required change once step 2 is real: **the
  allocator must always re-derive the spendable total by reading the
  wallet's actual burn transaction(s) on-chain**, not trust local state
  — so a refresh after a burn (or a burn that partially failed) always
  shows the true, currently-earned total. This is also what makes the
  whole flow refresh-safe per Dylan: *"the free mint allocator should
  always check their TXN on chain to confirm what they burned... that
  way if theres anything wrong with the burning process, they can
  refresh after the txn and it will still verify."*
- **Step 4 — Mint**: genuinely cannot be built yet — there is no
  deployed mint contract on Robinhood Chain, Base, or Solana (see the
  "⚠️ CONTRACT REQUIREMENT" section up top; ERC721A decided, nothing
  deployed). Dylan's framing: 1 mint transaction per target chain
  (so up to 3 total, not 3 per track), each minting a **randomly
  selected** set of editions from across the catalog to the user
  (ties into the separate "Explore: fully-random free mints" note
  above — same idea, now scoped as the literal step 4 action rather
  than just an idea). Stays a disabled placeholder until those
  contracts exist and are deployed — a real, separate contract-writing
  engagement, not a `/burn` page change.
- **Recording**: once step 2 is real, every burn tx needs to be recorded
  server-side (new Redis keys, same `@upstash/redis` pattern already
  used by `lib/boardStore.ts`/`lib/chatStore.ts`) so step 3's on-chain
  re-verification has something to reconcile against and so a wallet's
  total earned-but-unspent mint count can be tracked across sessions —
  not designed in detail yet, next thing to spec once step 2's
  enumeration blocker is clear.

**Solana and Tezos wallet checkers shipped 2026-07-27** (`components/
SolanaWalletChecker.tsx` + `lib/solanaCollectionCheck.ts`;
`components/TezosWalletChecker.tsx` + `lib/tezosCollectionCheck.ts` +
`lib/tezosBeacon.ts`) — same collapsible-header pattern as the ETH
checker (closed by default, toggle to expand). `/burn` shows only the
three checkers' header rows by default (Dylan: "only show this part by
default... make the rest of it collapsible"); the full `LEGACY_ASSETS`
contract list sits behind a separate "View every eligible contract"
toggle, also closed by default.

**Checking no longer auto-expands the breakdown** (Dylan: "when you
click check, dont go to the dropped down state. just check it, but
also show the number of free mints to the left of the check box after
checked"). All three checkers dropped their `setOpen(true)` after a
successful check; instead a `.checker-mints-badge` pill (the live
spendable total) renders next to the `✓ Checked` badge in the title row
the moment results exist, and the ▼/▲ toggle is the only way to expand
the full per-tier breakdown.

**Solana detection was actually broken — root-caused and fixed
2026-07-27.** The original heuristic compared a token's on-chain
Metaplex `symbol` field against the marketplace collection *slug*
(`"crypto_rich_deluxe_trading_cards"`, 33 characters) — that could
never match anything: Metaplex's on-chain symbol is capped at 10 bytes,
so a string that long was never actually stored on-chain. Confirmed
live against the collection's own floor NFT (mint
`3r7CWTme5bM4nNwHk9GRjygBBS2i5n5R3CQV4GvwQwsu`, per the candy machine
section above): its real on-chain symbol is `"CRT"`, and its full name
is `"Crypto Rich Standard Card #184"`. Fixed by checking what actually
proves candy-machine membership: the metadata's `creators` array has
the candy machine ID (`7Jvmu...sgPw`) first, with `verified: true` —
Metaplex sets that flag via the mint's own `sign_metadata` call, so it
can't be forged by a later holder, unlike a symbol/name string. Tier
(Standard/Gold/Platinum/Diamond) is then read straight off the same
on-chain `name` field via a simple word match — no off-chain JSON fetch
needed. This upgraded Solana from an unreliable min–max range to the
same exact per-tier precision the ETH checker already had.

**Tezos now connects a real wallet instead of paste-an-address**
(`lib/tezosBeacon.ts`) — the original paste-tz1-address flow was a
deliberate placeholder (see below for why it existed), superseded once
Dylan asked to "actually allow them to connect Temple wallet or trust
wallet... make it happen and make it smooth." Neither Temple nor Trust
Wallet exposes a simple injected `window.temple`-style provider —
Temple's own extension docs describe a content-script/Beacon bridge,
not a global object — so `@airgap/beacon-sdk`'s `DAppClient` (the
TZIP-10/Beacon standard, and the vendor-recommended integration path
both wallets actually implement) is what's used, same "use the
official widget-integration pairing" call already made for RainbowKit/
Relay elsewhere in this app rather than hand-rolling wallet detection.
One `requestPermissions()` call opens Beacon's own real pairing modal —
verified live, no crash, real wallet icons (Temple shows up
automatically since the extension self-registers as a Beacon peer).
Trust Wallet doesn't implement Beacon natively (confirmed: still an
open feature request against `trustwallet/wallet-core` as of this
build) but Beacon added WalletConnect v2 as a transport specifically so
WC2-only wallets can reach Tezos dApps without their own Beacon
integration, and Trust Wallet supports WC2 for Tezos — so the same
single modal covers both, there's no way to route straight to "just
Temple" or "just Trust" without reimplementing Beacon's own
pairing/transport logic, and there's no need to. `getActiveAccount()`
restores the session on reload; `clearActiveAccount()` backs a
"Disconnect" link shown next to the connected (truncated) address.

**Dashboard "Total Volume" info tooltip, custom-styled** (`components/
MultichainOverview.tsx`) — was a plain native `title` attribute on the
whole clickable volume tile, so the browser's own default tooltip
covered the entire box and only appeared after a slow OS-level hover
delay. Dylan: "stylize the flag to match our site... only show this
when they hover over the word Total Volume not the whole box... make
it obvious you can hover it for more info." Replaced with a
`.dash-vol-info` span wrapping just the "Total Volume" label (dotted
underline + a small ⓘ icon, `cursor: help`) and a `.dash-vol-tip`
bubble absolutely positioned below it, styled with the same square
Win95 bevel border used everywhere else — shown on hover/focus via CSS
only, `tabIndex={0}` so it's reachable without a mouse too. Only
rendered while `volumeView === "total"` (the toggle's other state, "V2
Volume", is self-explanatory and doesn't need it). Clicking anywhere on
the tile — including the label/icon — still toggles between Total and
V2, unchanged; hover is scoped narrower than click on purpose.

### Explore: fully-random free mints (not built yet)

Dylan, 2026-07-27: *"I want the free mints to be totally random. so if
you have 20 mints, you might get 5 of the same song."* Idea is that
spending N free mints wouldn't let a user hand-pick which N tracks they
get — each mint would roll a random track from the target album/chain,
so a large mint count could land duplicates instead of one-of-each.
Worth exploring against the allocator above (`components/
BurnWalletChecker.tsx`'s "Plan how to spend it" — currently a chain-level
split only, no track-level choice at all yet) once real burning/minting
is actually wired up — not evaluated for feasibility yet, just captured
here per Dylan's request so it isn't lost.

### Starting mint stats — flat 10% everywhere, not a random "looks alive" number

`lib/albums.ts` `baselineMinted()` used to return a deterministic
pseudo-random 0–40/100 per track+chain, purely cosmetic "this looks live"
texture. Replaced with a flat `PRE_MINTED_EDITIONS = 10` (10/100 = 10%,
same on every chain) per Dylan: "update the stats... 10% of items minted
because editions 1-10 will be auto minted and auto listed for sale... it
will start at 10% on every chain" — matches the "Deployment minting
strategy" section above (editions #1–10 auto-minted + auto-listed at
launch, public mints start at #11). `Track.baselineMintedSeed` is kept
(no longer used for mint-count seeding) since `lib/streams.ts` still uses
it to seed its own unrelated fake play-count number.

### Global chat dock (`components/GlobalChatWidget.tsx`) — every page, collapsible

Dylan: "what if the chat is always in the bottom right - but its collapsed
into just a line unless you click it to pop it open on any screen... when
miniplayer is active, put the chat above the miniplayer." Mounted once in
the ROOT layout (`app/layout.tsx`, alongside `DesktopBackground`) so it
persists across every route, not just the `(app)` shell — hides itself on
`/chat` specifically so the full chat page and the dock never show the same
thing twice. Reuses the exact same `/api/chat` store as the full page
(same messages, same `ownsAnyEdition` gate to post) — a quick-access dock
on the same data, not a second inbox. Since it renders outside the
`(app)` layout, it can't use `useAppShellContext()` (home-page-safe only
inside that route group) — wallet identity comes straight from wagmi's
`useAccount()` instead, checked against the `"robinhood"` chain's local
holdings. Collapsed state is a thin `.gcw-tab` pill bottom-right; expanded
is a compact `.gcw-window` (270px tall, Win95-bevel chrome matching
everything else on the site). Lift-above-MiniPlayer is a fixed
`bottom: 328px` swap via a `.gcw-lifted` class toggled on
`player.playingTrack` truthiness (from the root-level `PlayerContext`) —
an approximation of MiniPlayer's real height, not a measured one, and only
tracks MiniPlayer's *default* docked position (MiniPlayer is itself
draggable now — see below — so this doesn't follow it once dragged
elsewhere).

### MiniPlayer is now a real Win95 window — draggable, square chrome

Dylan: "let the miniplayer be dragged around so it really feels like an
OS... make it look like a windows 95 window." Added a `.mini-player-titlebar`
drag handle (pointerdown/move/up, same technique `DesktopFiles.tsx`
already used for the desktop icons — capture on down, `setPos` on move,
clamped to the viewport) that repositions the whole player via `left`/`top`
inline styles once dragged (defaults to its original `bottom`/`right` CSS
position until then). Toggle/skip buttons and the outer frame all lost
their `border-radius:999px`/`50%` in favor of the same square 2px-bevel
raised-button look used everywhere else on the site now (see below) — the
close "×" became a small `.win95-close`-style square button in the new
titlebar instead of a bare glyph in the top row.

### Square Windows-95 buttons, site-wide

Dylan: "make all buttons square and windows 95 vibe instead of the rounded
button pills." Every pill-shaped interactive element (`border-radius:
999px`) — chain switcher, wallet pill, swap CTA/token pills, taskbar tabs,
token-picker pills, burn-page buttons, etc. — was restyled with the same
2px raised-bevel border technique the taskbar/windows already used (light
top-left, dark bottom-right; inputs get the inverse "inset" bevel).
Decorative round elements (status dots, avatar circles, token icons) were
deliberately left alone — the ask was about buttons/pills reading as
Windows-95, not every circular thing on the page. Window frames
(`.win95-window`, `.aim-window`, `.start-menu`, `.aim-mini-window`) also
got a heavier bottom/right border (2px→3–4px, darker) per a follow-up:
"the windows need more of a bottom border... to feel more like a windows
95 window."

### Desktop-icon click regression (real bug, found and fixed this session)

The draggable "desktop icon" tracks scattered behind every page
(`components/DesktopFiles.tsx`, rendered once via `DesktopBackground` in
the root layout) had silently become unclickable — confirmed live via
`document.elementFromPoint()` at each icon's real screen position: an
unstyled wrapper `<div>` that `RainbowKitProvider` renders around page
content (no class to target directly), plus `.landing`/`.landing-page`'s
own full-viewport "empty" margins, were winning every hit-test over the
icons behind them even though nothing was visibly painted there —
`pointer-events:none` on an ancestor doesn't remove the ancestor ITSELF
from hit-testing, only that element and its non-opted-back-in descendants.
Fixed with a `pointer-events: none` / `auto` cascade (none on the
RainbowKit wrapper + `.landing-page` + `.landing`, explicit auto back on
every real interactive container: `.landing-inner`, `.landing-wallet-corner`,
`.bio-section`, `.site-taskbar`, `.start-backdrop`/`.start-menu`,
`.mini-player`) — scoped via a `body > div:has(> .landing-page)` selector
so only the homepage's specific wrapper shape is touched, not other
routes. **This surfaced a second, real regression along the way**:
promoting `.desktop-bg` off `z-index:-1` (needed so hit-testing could
actually reach it once the blockers above were skipped) made it paint
*above* any plain non-positioned page content, since non-positioned
in-flow boxes sit in a lower CSS stacking layer than positioned
`z-index:auto/0` ones regardless of DOM order — `.win95-window` (used by
`/board`, `/burn`, `/dashboard`, `/beats`, `/admin`, `/chat`'s
`.aim-window`) went invisible, the desktop starfield showing straight
through it. Fixed by giving those same window-frame containers
(`.win95-window`, `.aim-window`, `.admin-wrap`, `.start-menu`,
`.aim-mini-window`) their own `position: relative; z-index: 1` so they
reliably paint back on top — caught via a live screenshot comparison
before shipping, not assumed fixed from the pointer-events change alone.

### `/board` — Windows-95 bulletin board (`components/BulletinBoard.tsx`, `lib/boardStore.ts`)

Dylan: "make a page called Board... windows 95 themed bulliten board where
community members can post a short message and it stays there pinned up...
just get the rough idea up." Same Redis/Upstash pattern as
`lib/chatStore.ts` (`app/api/board/route.ts`, `dylmusic:board:notes` list
key, `MAX_NOTES=300`) — posts are pinned (read back newest-first, nothing
auto-scrolls away) rather than a chat transcript. Requires a connected
wallet to post, no edition-gate (open to any community member, unlike
`/chat`). **Rendered as an actual corkboard**: `.corkboard` is a 5-column
CSS grid (Dylan: "smaller messages... more like post it notes that go 5
across," collapsing to 3/2 columns on narrower viewports), each
`.board-note` a small tilted sticky note (fixed per-note angle from a
`TILTS` array, not re-randomized per poll). **Color, poster-chosen**:
first shipped as one random color per note from a fixed palette
(`lib/boardColors.ts`, `NOTE_COLORS` — yellow/pink/green/blue/orange/
purple), then changed to a swatch picker in the composer per Dylan ("let
the poster set the notes color actually") — the chosen color is now part
of the stored `BoardNote` (`color: NoteColor`), validated server-side via
`isNoteColor()` against the same whitelist rather than trusting arbitrary
CSS from the client into an inline style. `lib/boardColors.ts` is
deliberately split out from `lib/boardStore.ts` so the client-side
composer doesn't have to pull in `boardStore.ts`'s `@upstash/redis` import
just for the color constants. Sorting by token/edition holdings is the
explicitly-deferred next step, not built yet — this is "the rough idea,"
per Dylan's own framing.

### BurnWalletChecker → "EVM Wallet Checker" (checks Ethereum + Base + Polygon at once)

Dylan: "Check all EVM wallets at once... 787 eligible NFTs found and XXX
$Dyl coin found. Display the total for both NFTs and Dyl Coin right
there." NFT checks are still Ethereum-only (no known Base/Polygon NFT
contract addresses exist yet — the old Polygon collection was on
MintSongs, which is defunct, no address recorded), but $DYL is now read
on all 3 EVM chains it actually has a deployed address on
(`EVM_DYL_TOKENS` in the component, sourced from `LEGACY_ASSETS`) —
same wallet address, 3 separate `createPublicClient` reads (mainnet via
the existing public RPC, Base/Polygon via viem's own default chain RPCs,
no custom URL needed). The combined $DYL total across all 3 chains is
what the burn-credit threshold table applies to, not each chain
separately. A prominent two-part hero stat
(`.burn-checker-total-combined`) now shows both totals side by side —
"N eligible NFTs found" and "N $DYL coin found" — instead of just the NFT
count that was there before.

### `/about` — AIM-bubble explainer page

Dylan: "add an About page to the right of Board... explain whats going on
here... make it in a chat format like the chat on the homepage. like im
describing it to you via AIM in a chat." Reuses the exact same
`.aim-mini-window`/`.aim-msg` bubble components the homepage's mini chat
preview uses (not the scrolling-log `.aim-window` style `/chat` uses) —
just widened (`.about-window`, `max-width:640px`) and non-interactive
(plain `<div>`s, not buttons — `.about-msg` cancels the hover highlight
so it doesn't read as clickable). Content is a fixed, honest 7-bubble
explanation in Dyl's voice covering: who he is, what dylmusic is, the
100-editions-per-chain mint model, the legacy-NFT burn program, /board +
/chat, and an explicit "this is still early, no real contracts yet"
disclaimer — no fabricated stats or promises, matching the site's own
existing honesty conventions elsewhere. Nav order: Music/Dashboard/Chat/
Swap/Beats/Burn/Board/**About** (last, right of Board, per Dylan's exact
placement request) — `GlobalTaskbar.tsx` `NAV_ITEMS` + `(app)/layout.tsx`
`pageTitle`.

### Two real bugs caught testing the batch above, both fixed same session

- **Clicking the collapsed chat tab did nothing, homepage only**: the
  `body > div:has(> .landing-page) { pointer-events: none }` rule from
  the earlier desktop-icon fix also covers `GlobalChatWidget`'s own
  markup, since it's mounted as a sibling of `.landing-page` inside that
  same RainbowKit wrapper div (root layout renders
  `<DesktopBackground/>{children}<GlobalChatWidget/>` all as siblings).
  Fixed with explicit `pointer-events: auto` on `.gcw-tab`/`.gcw-window`,
  same pattern as `.mini-player`/`.site-taskbar`/etc already needed.
- **MiniPlayer's × close button didn't work** (dragging worked fine):
  the button lives inside `.mini-player-titlebar`, which calls
  `setPointerCapture` on itself (`e.currentTarget`) on every
  `pointerdown` to support dragging — capturing the pointer to the
  titlebar hijacks the subsequent click synthesis on the button inside
  it. Fixed with `onPointerDown={(e) => e.stopPropagation()}` on the
  close button itself, so a click on it never reaches the drag handler
  at all. Classic "interactive element nested inside its own custom
  drag handle" bug — same fix would apply to any future button added
  inside that titlebar.

Also: `.gcw-tab-dot` (and the titlebar's matching dot) got a pulsing
green glow (`box-shadow` + a `gcw-pulse` keyframe) per Dylan wanting it
to visibly "look active," since a flat dark dot sitting on the same
accent-green background it was trying to indicate status against read as
inert.

### Real per-token tier lookup for the burn checker — Dylan called out the estimate, and he was right to

The min-max range described above was replaced with **exact** tiers.
Dylan's reaction to the range: "why cant you check the types? ... Actually
check them" — correct pushback. The earlier "blocker" (a raw
`eth_getLogs` full-history call rejected by `ethereum-rpc.publicnode.com`,
block-range capped) was a real dead end, but giving up there was wrong —
**Blockscout's public REST API** (`eth.blockscout.com/api/v2/tokens/
{contract}/instances?holder_address_hash={wallet}`) indexes exactly this:
every tokenId a wallet currently holds for a contract, paginated (50/page,
`next_page_params` cursor), **with full metadata (including the `Edition`
trait) inline in the response** — no separate per-token IPFS fetch needed
at all, no API key, CORS wide open (`access-control-allow-origin: *`), so
it runs straight from the browser. Verified live against Dylan's own
wallet before shipping: 235 tokens across 5 pages, exactly matching the
earlier `balanceOf` count, classified as 199 Standard / 14 Gold / 2
Platinum / 1 Diamond / 16 VIP (album covers, singles, PFP) / 3 unrevealed
Mystery cards. `lib/tieredCollectionCheck.ts` does this lookup;
`BurnWalletChecker.tsx`'s credits panel now shows the real per-tier
breakdown and an exact spendable total (Diamond and Mystery-tier tokens
are shown but excluded from the total — still genuinely unpriced/
unknown, not estimated away). **Lesson for future sessions**: when a
public RPC method fails, that's evidence against that specific method, not
against the underlying question being answerable — a block explorer's own
indexed API is often the right tool for "what does this wallet hold,"
not raw log scanning.

### Real, server-tracked stream counts (`lib/streamsStore.ts`, `/api/streams`)

Dylan: "wire it up to track every single stream, whether it gets played in
miniplayer or on the music page. start tracking the streams now... this
will be the start of the real running stream count. We'll need to store
that data in vercel along with our other data storage." Replaced
`lib/streams.ts`'s old per-browser localStorage + deterministic-pseudo-
random baseline entirely — real counts now live in the same Upstash Redis
already used for chat/board (`dylmusic:streams:counts`, one Redis hash,
`HINCRBY` per play). **Every play funnels through one choke point**:
`PlayerContext.tsx`'s `toggleTrack` is the single call site for
`recordStream()`, regardless of whether playback started from MiniPlayer,
the `/music` track list, the homepage console preview, or a desktop-icon
click — so wiring it once there covers every trigger, no per-component
changes needed. Starts at **zero** for every track, no blended baseline,
per Dylan's own framing ("this will be the start of the real running
count"). Client-side (`getStreamCount`) reads a small in-memory cache
populated by one `/api/streams` GET, with a `useStreamCountsLoaded()`
hook components call once to trigger that fetch and re-render when it
lands (`AlbumView.tsx`, `MultichainOverview.tsx`) — kept as a plain
synchronous `getStreamCount(track)` read rather than converting every
call site to a hook, to avoid a bigger refactor.

### "Why can't board/chat data live on Vercel?" — it already does

Dylan asked this directly. Short answer: it already does, via the same
mechanism every other piece of real shared state on this site uses —
Upstash Redis, which is exactly what **Vercel's own "Marketplace
Database Storage — Upstash for Redis"** integration provisions (Vercel
doesn't run its own Redis; the old first-party "Vercel KV" product was
Upstash under the hood too, now folded into this marketplace integration).
`getRedis()` in `lib/chatStore.ts`/`boardStore.ts`/`streamsStore.ts`
already reads either env var naming convention
(`UPSTASH_REDIS_REST_URL/TOKEN` or `KV_REST_API_URL/TOKEN`) so it works
with either the direct Upstash dashboard or the Vercel-integration flow
with zero code changes. **If a feature ever shows "isn't configured on
this deployment yet"** (seen live on `/board` during this session's own
testing), the store code isn't the issue — it means those env vars
genuinely aren't set on that specific Vercel deployment/environment yet.
Fix is in the Vercel dashboard, not code: Project → Storage → connect (or
verify) the Upstash integration for the environment being tested
(Production vs. Preview have separate env var sets), or confirm the var
names actually match one of the two pairs above.

### Admin wallet (0x9e01...35b5) — always-post, delete, and pin, chat + board

Dylan: "give my wallet ... access so that i can always write in chat,
delete messages in chat and board, and i can pin stuff to board and pin
something in chat." Delete already existed for both (gated on
`isAdminWallet` from `lib/admin.ts`) — added the rest:
- **Always-post**: `/chat` and `GlobalChatWidget.tsx`'s `canPost` now
  reads `isAdminWallet(address) || ownsAnyEdition(...)` — the admin
  wallet bypasses the hold-an-edition gate everyone else needs.
- **Pin in chat**: new `PATCH /api/chat` (`{id, wallet, pinned}`,
  admin-only) → `lib/chatStore.ts` `setMessagePinned()` (read-modify-
  rewrite the list, same technique `deleteMessage` already used — no
  per-item Redis key exists to target directly). `readMessages()` now
  sorts pinned-first. Pinned messages get a visible highlight (accent
  left-border + a small "PINNED" flag) in both `/chat` and the global
  dock, and admin sees inline Pin/Delete text-buttons on every line.
- **"Pin" to board**: board posts were already unrestricted (any
  connected wallet can post — no edition-gate there), so this became a
  distinct **Feature** concept instead of literally "let admin post" —
  `BoardNote.pinned`, `PATCH /api/board` → `setNotePinned()` (same
  rewrite technique), pinned/featured notes sort first and get a gold
  ring (`.board-note.featured`) + a "★ FEATURED" flag. Deliberately
  named "Feature"/"Unfeature" in the board's own admin buttons (not
  "Pin") since every board note is already conceptually "pinned" to the
  corkboard — reusing that word there would've been confusing next to
  the *composer's* own "Pin it" (= post) button.

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

**"Buy Album" is a real, separate batch-mint shape — not the same as
ERC721A's own `mint(quantity)`.** Shipped 2026-07-28 in the simulated
flow (`components/AlbumView.tsx` `confirmBuyAlbum`, `components/
BuyConfirmModal.tsx`'s `album` prop): buying a whole album now goes
through the same Pay-With confirm modal a single track uses, one
confirmation covering every track in the album in one go (Dylan: "when
they do buy an album, it still needs the buy button popup interface...
that's going to execute a multi-buy for all 19 items at once"). Also
fixed the button in the same change: it used to hard-disable once every
track was owned once ("Album complete"), with no way to buy a second
full run — Dylan: "yes, indicate that, but allow them to buy it again -
duh." The button is now only disabled by a real sellout (every track at
its cap); the ★ Collected badge still shows the complete state.
**The real contract implication, per Dylan's own ask to note it**:
ERC721A's `mint(quantity)` batch-gas-savings only apply to *sequential
token ids under one track's own id range* (see the ERC721A section
above) — an album buy needs to mint across **19 different,
non-sequential ranges (one per track)** in a single wallet action. That
is not the same primitive at all. Two real options once contracts
exist: (a) a custom `batchMintAcrossTracks(trackIds[], quantities[])`
function on the collection contract itself, purpose-built for this, or
(b) wrap N separate `mint(quantity)` calls (one per track) inside a
Multicall3-style aggregator so it still lands as one signed
transaction. Neither is built — this is scope for whoever writes the
real contract, flagging it now so "buy album" isn't assumed to fall out
of the single-track batch-mint work for free.

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
this panel around the fact there are exactly 4 target collections total
(Robinhood Chain, Base, Ethereum, Solana — Ethereum added 2026-07-28) plus
the optional marketplace contract — not a generic "deploy any contract"
tool. `lib/admin.ts` `CONTRACT_TARGETS` is already this exact ordered list
(with per-step `reason` strings), and `/admin`'s Contracts section already
renders it as a numbered 1-5 sequence — the Deploy/Upgrade buttons there
are still disabled placeholders since nothing is deployed yet, but the
shape (`order`, `reason`, per-target `key`) already matches what real
deploy tooling should read from, extend it rather than hardcoding a
separate list. A third button, **"Mint #1-10 & List"**, is also already
scaffolded next to Deploy/Upgrade for each of the 4 collection rows
(disabled, same honest reasoning) — that is the concrete admin action for
the "Deployment minting strategy" below, one per chain, not a single
global button.

---

## Dashboard — `/dashboard`

**NFT stats are the priority section and must be at the top; streaming
stats go below.** A "quick stats" row sits above both: total ETH volume
(click to toggle the same figure into SOL), total streams, plus other key
top-line numbers. This ordering is deliberate — Dyl explicitly called NFT
data "priority" over streaming data.

---

## Chains

`lib/albums.ts` `CHAINS` / `ChainKey = "robinhood" | "base" | "solana" | "ethereum"`
(Ethereum added 2026-07-28 — gas cheap enough now to be worth it).
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

## Mobile optimization pass (2026-07-27)

Dylan: "MOBILE OPTIMIZATION... it works great for browser, but we need to
mobile optimize... we want it to have that windows 95 feel, but still be
navigable on mobile... check each page with real phone dimensions." Before
this, mobile coverage was almost nonexistent (4 `@media` blocks total,
mostly for the board's corkboard grid). Verified with real iPhone-dimension
CDP emulation (393×852, `mobile:true`, real touch + Safari UA — not
headless `--screenshot`'s misleading ~800px default) across every page.

**The one real structural bug, found on the homepage**: `.desktop-bg` (the
scattered clickable track icons behind every page) is `position:fixed` —
pinned to exactly one viewport. On desktop the hero content roughly fits
one viewport so a static avoid-rect mostly works; on mobile the same
content stacks into a column several viewports tall that scrolls
underneath the fixed icon layer, so icons collide with whatever text
happens to scroll into that same fixed screen position — no static or
even per-page-dynamic avoid-rect can fix this, since the icon layer can't
know what's currently scrolled beneath a fixed position. Fixed by simply
not rendering `<DesktopFiles>` below 640px width (`DesktopBackground.tsx`,
a `matchMedia` check) — the `Visualizer` particle background still
renders, and the Windows-95 feel still comes through fully via the
taskbar/window chrome/Start menu, which don't have this problem.

**The other real bug**: `.app-header` (logo + chain switcher + wallet
pill, present on every `(app)`-shell page) had a mobile rule setting
`.chain-switch { width:100%; order:3 }` to push it to its own row, but the
parent never got `flex-wrap: wrap` — so the 100%-wide child couldn't
actually wrap, and the chain pills just overflowed/got clipped off-screen
instead. One missing property was breaking chain switching on every
single app page on mobile. Fixed by adding `flex-wrap: wrap` +
shrinking pill/wallet-pill padding/font in the same media query.

**Everything else was mostly already in good shape** once those two were
fixed — `/dashboard`, `/chat`, `/board`, `/about`, `/burn`, `/swap` (this
one especially — the whole custom swap card + token picker modal was
already cleanly responsive with no changes needed), `/beats`, `/admin`,
and the Start menu's own track list all rendered correctly on first check.
Specific additional fixes made:
- `/music`'s discography grid rendered each album cover nearly full-
  viewport-width (single `auto-fill minmax(180px,1fr)` column) — capped
  to a 2-column grid under 640px.
- `MiniPlayer` (the desktop-style seek-bar + buy/sell card) was too tall
  on a phone and covered a large chunk of whatever page was behind it —
  collapsed to a slim single-row bar on mobile (`.mini-player-seek`,
  `.mini-player-actions` hidden below 640px); Buy/Sell are still reachable
  from the Start menu's own per-track buttons, which already exist.
- `.btn-sweep` ("Buy Album") was still `border-radius:12px` — missed in
  the earlier site-wide button-squaring pass; squared to match.
- Dashboard led with the album's own title (`{album.title}` as the `h1`)
  — Dylan: "remove Crypto Rich (Deluxe) from top of dashboard its
  supposed to be overall stats first." Changed to a generic "Platform
  Overview" heading with the album named only in a small subtitle, so the
  quick-stats row is the first real content.
- `BurnWalletChecker`'s hero stat line now shows all three numbers
  together — "N eligible NFTs found · N $DYL coin found · = N free
  mints" — instead of just the first two, per Dylan's exact requested
  format.
