import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(__dirname, "../../lib/contracts");

const TARGETS: Array<[string, string]> = [
  ["contracts/DylCollection.sol/DylCollection.json", "DylCollection.json"],
  ["contracts/AlbumBuyer.sol/AlbumBuyer.json", "AlbumBuyer.json"],
  ["@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json", "ERC1967Proxy.json"],
];

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const [src, dest] of TARGETS) {
  const full = JSON.parse(fs.readFileSync(path.join(__dirname, "../artifacts", src), "utf8"));
  fs.writeFileSync(
    path.join(OUT_DIR, dest),
    JSON.stringify({ abi: full.abi, bytecode: full.bytecode }, null, 2) + "\n"
  );
  console.log(`Exported ${dest}`);
}

console.log(`Done -> ${OUT_DIR}`);
