"use client";

export default function Landing({
  onConnectEvm,
  onConnectSol,
}: {
  onConnectEvm: () => void;
  onConnectSol: () => void;
}) {
  return (
    <div className="landing">
      <div className="landing-grid" aria-hidden />
      <div className="landing-content">
        <div className="landing-mark">dyl</div>
        <h1>own the track.</h1>
        <p>
          Numbered editions of my music. 100 per track, any chain. Hold it,
          play it, or list it.
        </p>
        <button className="btn-connect" onClick={onConnectEvm}>
          Connect Wallet
        </button>
        <button className="landing-sol-link" onClick={onConnectSol}>
          or connect Phantom for Solana
        </button>
      </div>
    </div>
  );
}
