/**
 * Configuracion operativa de TreasuryRouterV2 (escrow de referral).
 *
 * Idempotente: solo envia transacciones si el estado onchain difiere.
 * Requiere DEFAULT_ADMIN_ROLE y que el contrato no este pausado.
 *
 * Variables de entorno:
 *  TREASURY_ROUTER_V2          direccion del router (o deployments/<red>.json)
 *  RELEASE_EXECUTOR            cuenta autorizada a liberar escrow
 *  RELEASE_EXECUTOR_ENABLED    "false" para revocar el ejecutor (default: true)
 *  REFERRAL_FALLBACK_WALLET    wallet de comisiones para escrow no liberado
 *  DRY_RUN                     "true" para solo diagnosticar
 *
 * Uso:
 *  npx hardhat run scripts/configure-v2.ts --network pre
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [signer] = await ethers.getSigners();
  const dryRun = process.env.DRY_RUN === "true";

  const recordPath = path.join(
    __dirname,
    "..",
    "deployments",
    `${network.name}.json`
  );
  const record = fs.existsSync(recordPath)
    ? JSON.parse(fs.readFileSync(recordPath, "utf8"))
    : {};

  const address =
    process.env.TREASURY_ROUTER_V2 ?? record.contracts?.TreasuryRouterV2;
  if (!address || !ethers.isAddress(address)) {
    throw new Error("TREASURY_ROUTER_V2 no configurada o invalida");
  }

  const executor = process.env.RELEASE_EXECUTOR;
  const executorEnabled = process.env.RELEASE_EXECUTOR_ENABLED !== "false";
  const fallbackWallet = process.env.REFERRAL_FALLBACK_WALLET;
  if (!executor && !fallbackWallet) {
    throw new Error("Indica RELEASE_EXECUTOR y/o REFERRAL_FALLBACK_WALLET");
  }

  const router = await ethers.getContractAt("TreasuryRouterV2", address, signer);

  console.log(`Red:      ${network.name}`);
  console.log(`Signer:   ${signer.address}`);
  console.log(`Router:   ${address}`);
  if (dryRun) console.log("MODO DRY_RUN: no se enviaran transacciones");
  console.log("---");

  const paused = await router.paused();
  const isAdmin = await router.hasRole(ethers.ZeroHash, signer.address);
  console.log(`pausado: ${paused} · DEFAULT_ADMIN_ROLE: ${isAdmin}`);

  if (executor) {
    if (!ethers.isAddress(executor)) throw new Error("RELEASE_EXECUTOR invalida");
    const current = await router.releaseExecutors(executor);
    console.log(`releaseExecutors[${executor}] = ${current} (objetivo: ${executorEnabled})`);
    if (current !== executorEnabled && !dryRun && !paused && isAdmin) {
      const tx = await router.setReleaseExecutor(executor, executorEnabled);
      await tx.wait();
      console.log(`  actualizado (${tx.hash})`);
    }
  }

  if (fallbackWallet) {
    if (!ethers.isAddress(fallbackWallet)) {
      throw new Error("REFERRAL_FALLBACK_WALLET invalida");
    }
    const current = await router.referralFallbackCommissionWallet();
    console.log(`referralFallbackCommissionWallet = ${current} (objetivo: ${fallbackWallet})`);
    if (
      current.toLowerCase() !== fallbackWallet.toLowerCase() &&
      !dryRun &&
      !paused &&
      isAdmin
    ) {
      const tx = await router.setReferralFallbackCommissionWallet(fallbackWallet);
      await tx.wait();
      console.log(`  actualizado (${tx.hash})`);
    }
  }

  if (paused) console.log("AVISO: contrato pausado; la configuracion esta bloqueada");
  if (!isAdmin) console.log("AVISO: el signer no tiene DEFAULT_ADMIN_ROLE");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
