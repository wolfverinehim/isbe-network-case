/**
 * Genera wallets EOA (compatibles con MetaMask) para pruebas.
 *
 * Escribe las claves en wallets/<archivo>.json (carpeta ignorada por git) y
 * muestra por consola solo las direcciones.
 *
 * Variables de entorno:
 *  COUNT      numero de wallets a generar (default: 1)
 *  ROLES      lista de roles separados por coma; define el numero de wallets e ignora COUNT
 *  LABEL      nombre del archivo de salida (default: wallets)
 *  MNEMONIC   "true" para derivar todas desde una unica frase semilla
 *
 * Uso:
 *  npx hardhat run scripts/new-wallet.ts
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const roles = (process.env.ROLES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const count = roles.length > 0 ? roles.length : Number(process.env.COUNT ?? "1");
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new Error("COUNT debe ser un entero entre 1 y 100");
  }
  const label = (process.env.LABEL ?? "wallets").replace(/[^a-zA-Z0-9_-]/g, "");
  const fromMnemonic = process.env.MNEMONIC === "true";

  const wallets: Array<{
    index: number;
    role: string;
    address: string;
    privateKey: string;
    path?: string;
  }> = [];

  let mnemonicPhrase: string | undefined;

  if (fromMnemonic) {
    const root = ethers.Wallet.createRandom();
    mnemonicPhrase = root.mnemonic?.phrase;
    for (let i = 0; i < count; i++) {
      const derived = ethers.HDNodeWallet.fromPhrase(
        mnemonicPhrase!,
        undefined,
        `m/44'/60'/0'/0/${i}`
      );
      wallets.push({
        index: i,
        role: roles[i] ?? `wallet-${i}`,
        address: derived.address,
        privateKey: derived.privateKey,
        path: `m/44'/60'/0'/0/${i}`,
      });
    }
  } else {
    for (let i = 0; i < count; i++) {
      const wallet = ethers.Wallet.createRandom();
      wallets.push({
        index: i,
        role: roles[i] ?? `wallet-${i}`,
        address: wallet.address,
        privateKey: wallet.privateKey,
      });
    }
  }

  const outDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${label}-${Date.now()}.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      { createdAt: new Date().toISOString(), mnemonic: mnemonicPhrase, wallets },
      null,
      2
    )
  );

  console.log(`Generadas ${count} wallet(s). Direcciones:`);
  for (const wallet of wallets) {
    console.log(`  [${wallet.index}] ${wallet.role.padEnd(22)} ${wallet.address}`);
  }
  console.log("---");
  console.log(`Claves privadas guardadas en: ${path.relative(process.cwd(), outFile)}`);
  console.log("Esa carpeta esta ignorada por git. No compartas el archivo.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
