// The deployment minting strategy (CLAUDE.md "Deployment minting strategy"):
// editions #1-10 of every track are pre-minted to the admin wallet, then
// listed on secondary at an inverse price scale — the lower the edition
// number, the higher the price. Public minting for that track starts at
// edition #11, at the normal flat $0.99 price.
export function priceUsdForEdition(editionNumber: number): number {
  if (editionNumber < 1 || editionNumber > 10) {
    throw new Error(`priceUsdForEdition only applies to editions 1-10, got ${editionNumber}`);
  }
  return (11 - editionNumber) * 10;
}
