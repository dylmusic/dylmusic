// Mirrors onchain/contracts/DylCollection.sol's _tokenId() exactly:
// tokenId = trackId * TOKEN_ID_STRIDE + editionIndex0Based + 1
//
// The +1 keeps tokenId 0 permanently unused — ERC721A's _mintSpot requires
// tokenId > _sequentialUpTo() (0 in this contract), so tokenId 0 itself can
// never be spot-minted. Offsetting everything by 1 avoids relying on no
// track ever being trackId 0. Keep this file's math in sync with the
// contract if the scheme ever changes on either side.
export const TOKEN_ID_STRIDE = 1000;

export function decodeTokenId(tokenId: number): { trackId: number; editionNumber: number } {
  const zeroBased = tokenId - 1;
  const trackId = Math.floor(zeroBased / TOKEN_ID_STRIDE);
  const editionIndex0Based = zeroBased % TOKEN_ID_STRIDE;
  return { trackId, editionNumber: editionIndex0Based + 1 };
}

export function encodeTokenId(trackId: number, editionNumber: number): number {
  return trackId * TOKEN_ID_STRIDE + (editionNumber - 1) + 1;
}
