/**
 * Reparte gas nativo a las cuentas operativas.
 *
 * Solo envia la diferencia necesaria para alcanzar AMOUNT en cada destino,
 * asi que es seguro reejecutarlo.
 *
 * Variables de entorno:
 *  TARGETS   direcciones destino separadas por coma
 *  AMOUNT    saldo objetivo en unidades nativas (default: 0.0001)
 *  DRY_RUN   "true" para solo diagnosticar
 *
 * Uso:
 *  npx hardhat run scripts/fund-gas.ts --network pre
 */
import { ethers, network } from "hardhat";

async function main() {
  const [signer] = await ethers.getSigners();
  const dryRun = process.env.DRY_RUN === "true";

  const targets = (process.env.TARGETS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (targets.length === 0) throw new Error("Indica TARGETS");

  const target = ethers.parseEther(process.env.AMOUNT ?? "0.0001");

  console.log(`Red:      ${network.name}`);
  console.log(`Signer:   ${signer.address}`);
  console.log(`Objetivo: ${ethers.formatEther(target)} por cuenta`);
  const signerBalance = await ethers.provider.getBalance(signer.address);
  console.log(`Saldo signer: ${ethers.formatEther(signerBalance)}`);
  if (dryRun) console.log("MODO DRY_RUN: no se enviaran transacciones");
  console.log("---");

  for (const account of targets) {
    if (!ethers.isAddress(account)) {
      throw new Error(`TARGETS contiene una direccion invalida: ${account}`);
    }
    const balance = await ethers.provider.getBalance(account);
    if (balance >= target) {
      console.log(`${account}: ${ethers.formatEther(balance)} (suficiente)`);
      continue;
    }
    const amount = target - balance;
    console.log(`${account}: ${ethers.formatEther(balance)} -> envio ${ethers.formatEther(amount)}`);
    if (dryRun) continue;

    const tx = await signer.sendTransaction({ to: account, value: amount });
    await tx.wait();
    console.log(`  ok (${tx.hash})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
