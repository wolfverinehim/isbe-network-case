/**
 * Gestion de allowlists (tokens y recipients) en los routers ya desplegados.
 *
 * Idempotente: solo envia transacciones para las entradas que faltan.
 * Requiere que el signer tenga ALLOWLIST_ADMIN_ROLE y que el router no este pausado
 * (las funciones de allowlist llevan whenNotPaused).
 *
 * Variables de entorno:
 *  TOKENS               direcciones de tokens a allowlistar, separadas por coma
 *  RECIPIENTS           direcciones de recipients a allowlistar, separadas por coma
 *  TREASURY_ROUTER_V1   (opcional) direccion del router; si no, se lee de deployments/<red>.json
 *  SEND_ROUTER_V1       (opcional)
 *  TREASURY_ROUTER_V2   (opcional)
 *  SEND_ROUTER_V2       (opcional)
 *  ONLY_ROUTERS         (opcional) limita la ejecucion a routers concretos, separados por coma
 *  REMOVE               "true" para dar de baja en lugar de alta
 *  DRY_RUN              "true" para solo diagnosticar sin enviar transacciones
 *
 * Uso:
 *  npx hardhat run scripts/allowlist.ts --network pre
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const ALLOWLIST_ADMIN_ROLE = ethers.keccak256(
  ethers.toUtf8Bytes("ALLOWLIST_ADMIN_ROLE")
);

const ROUTERS = [
  { label: "TreasuryRouterV1", env: "TREASURY_ROUTER_V1" },
  { label: "SendRouterV1", env: "SEND_ROUTER_V1" },
  { label: "TreasuryRouterV2", env: "TREASURY_ROUTER_V2" },
  { label: "SendRouterV2", env: "SEND_ROUTER_V2" },
] as const;

function parseList(value: string | undefined, label: string): string[] {
  const items = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  for (const item of items) {
    if (!ethers.isAddress(item)) {
      throw new Error(`${label} contiene una direccion invalida: ${item}`);
    }
  }
  return items;
}

async function main() {
  const [signer] = await ethers.getSigners();
  const dryRun = process.env.DRY_RUN === "true";
  const remove = process.env.REMOVE === "true";

  const tokens = parseList(process.env.TOKENS, "TOKENS");
  const recipients = parseList(process.env.RECIPIENTS, "RECIPIENTS");
  if (tokens.length === 0 && recipients.length === 0) {
    throw new Error("Indica al menos TOKENS o RECIPIENTS");
  }

  const recordPath = path.join(
    __dirname,
    "..",
    "deployments",
    `${network.name}.json`
  );
  const record = fs.existsSync(recordPath)
    ? JSON.parse(fs.readFileSync(recordPath, "utf8"))
    : {};

  console.log(`Red:      ${network.name}`);
  console.log(`Signer:   ${signer.address}`);
  console.log(`Accion:   ${remove ? "baja" : "alta"}`);
  console.log(`Tokens:     ${tokens.join(", ") || "(ninguno)"}`);
  console.log(`Recipients: ${recipients.join(", ") || "(ninguno)"}`);
  if (dryRun) console.log("MODO DRY_RUN: no se enviaran transacciones");
  console.log("---");

  const only = (process.env.ONLY_ROUTERS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const { label, env } of ROUTERS) {
    if (only.length > 0 && !only.includes(label)) continue;
    const address = process.env[env] ?? record.contracts?.[label];
    if (!address) continue;
    if ((await ethers.provider.getCode(address)) === "0x") {
      console.log(`${label}: sin codigo en ${address}; omitido`);
      continue;
    }

    const router = await ethers.getContractAt(label, address, signer);
    console.log(`${label} (${address})`);

    const paused = await router.paused();
    const isAdmin = await router.hasRole(ALLOWLIST_ADMIN_ROLE, signer.address);
    console.log(`  pausado: ${paused} · ALLOWLIST_ADMIN_ROLE (signer): ${isAdmin}`);

    const adminAddress = process.env.ADMIN_ADDRESS;
    if (adminAddress && ethers.isAddress(adminAddress)) {
      const adminHasRole = await router.hasRole(ALLOWLIST_ADMIN_ROLE, adminAddress);
      const adminIsDefault = await router.hasRole(ethers.ZeroHash, adminAddress);
      console.log(
        `  ${adminAddress} -> ALLOWLIST_ADMIN_ROLE: ${adminHasRole} · DEFAULT_ADMIN_ROLE: ${adminIsDefault}`
      );
    }

    const pendingTokens: string[] = [];
    for (const token of tokens) {
      if ((await router.allowlistedTokens(token)) === remove) pendingTokens.push(token);
    }
    const pendingRecipients: string[] = [];
    for (const recipient of recipients) {
      if ((await router.allowlistedRecipients(recipient)) === remove) {
        pendingRecipients.push(recipient);
      }
    }

    if (pendingTokens.length === 0 && pendingRecipients.length === 0) {
      console.log(`  nada que hacer (todo ${remove ? "fuera de la allowlist" : "allowlisted"})`);
      continue;
    }

    if (dryRun) {
      console.log(`  pendientes -> tokens: ${pendingTokens.join(", ") || "-"}`);
      console.log(`  pendientes -> recipients: ${pendingRecipients.join(", ") || "-"}`);
      continue;
    }
    if (paused) {
      console.log("  PAUSADO: las allowlists estan bloqueadas; despausar antes");
      continue;
    }
    if (!isAdmin) {
      console.log("  el signer no tiene ALLOWLIST_ADMIN_ROLE; pendiente");
      continue;
    }

    for (const token of pendingTokens) {
      const tx = remove
        ? await router.removeTokenFromAllowlist(token)
        : await router.allowlistToken(token);
      await tx.wait();
      console.log(`  token ${remove ? "retirado" : "allowlisted"} ${token} (${tx.hash})`);
    }
    for (const recipient of pendingRecipients) {
      const tx = remove
        ? await router.removeRecipientFromAllowlist(recipient)
        : await router.allowlistRecipient(recipient);
      await tx.wait();
      console.log(`  recipient ${remove ? "retirado" : "allowlisted"} ${recipient} (${tx.hash})`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
