/**
 * Despliegue de los routers de Accuro para ISBE (Modalidad 2).
 *
 * Despliega TreasuryRouterV1 y SendRouterV1 con:
 *  - admin           -> DEFAULT_ADMIN_ROLE, ALLOWLIST_ADMIN_ROLE, PAUSER_ROLE
 *  - isbeGovernance  -> PAUSER_ROLE (requisito de homologacion ISBE)
 *
 * Opcionalmente despliega AccEURMock (solo testing) y configura allowlists.
 *
 * Variables de entorno (.env):
 *  ISBE_RPC_URL                 RPC de la red ISBE
 *  ACCOUNT_PRIVATE_KEY          Clave del deployer (la usa hardhat.config.ts)
 *  ADMIN_ADDRESS                Admin de los routers (multisig Accuro). Default: deployer
 *  ISBE_GOVERNANCE_ADDRESS      Gobernanza ISBE (obligatoria)
 *  DEPLOY_MOCK_TOKEN            "true" para desplegar AccEURMock y allowlistarlo
 *  TOKEN_NAME / TOKEN_SYMBOL    Nombre/simbolo del mock (default: Accuro Euro / AccEUR)
 *  INITIAL_MINT / MAX_SUPPLY    En unidades enteras (6 decimales). Default: 1000000 / 100000000
 *  RESERVE_RECIPIENT            (opcional) recipient de reserva a allowlistar
 *  COMMISSION_RECIPIENT         (opcional) recipient de comision a allowlistar
 *
 * Uso:
 *  npx hardhat run scripts/deploy.ts --network isbe
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();

  const admin = process.env.ADMIN_ADDRESS || deployer.address;
  const isbeGovernance = process.env.ISBE_GOVERNANCE_ADDRESS;

  if (!isbeGovernance || !ethers.isAddress(isbeGovernance)) {
    throw new Error(
      "ISBE_GOVERNANCE_ADDRESS es obligatoria (PAUSER_ROLE para ISBE, requisito de homologacion)"
    );
  }
  if (!ethers.isAddress(admin)) {
    throw new Error("ADMIN_ADDRESS no es una direccion valida");
  }

  console.log(`Red:        ${network.name}`);
  console.log(`Deployer:   ${deployer.address}`);
  console.log(`Admin:      ${admin}`);
  console.log(`ISBE gov:   ${isbeGovernance}`);
  console.log("---");

  // 1) TreasuryRouterV1
  const TreasuryRouter = await ethers.getContractFactory("TreasuryRouterV1");
  const treasuryRouter = await TreasuryRouter.deploy(admin, isbeGovernance);
  await treasuryRouter.waitForDeployment();
  const treasuryRouterAddress = await treasuryRouter.getAddress();
  console.log(`TreasuryRouterV1: ${treasuryRouterAddress}`);

  // 2) SendRouterV1
  const SendRouter = await ethers.getContractFactory("SendRouterV1");
  const sendRouter = await SendRouter.deploy(admin, isbeGovernance);
  await sendRouter.waitForDeployment();
  const sendRouterAddress = await sendRouter.getAddress();
  console.log(`SendRouterV1:     ${sendRouterAddress}`);

  // 3) (Opcional, solo testing) AccEURMock + allowlists
  let tokenAddress: string | undefined;
  if (process.env.DEPLOY_MOCK_TOKEN === "true") {
    const name = process.env.TOKEN_NAME ?? "Accuro Euro";
    const symbol = process.env.TOKEN_SYMBOL ?? "AccEUR";
    const initialMint = ethers.parseUnits(
      process.env.INITIAL_MINT ?? "1000000",
      6
    );
    const maxSupply = ethers.parseUnits(
      process.env.MAX_SUPPLY ?? "100000000",
      6
    );

    const Token = await ethers.getContractFactory("AccEURMock");
    const token = await Token.deploy(
      name,
      symbol,
      deployer.address,
      initialMint,
      maxSupply
    );
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();
    console.log(`AccEURMock:       ${tokenAddress}`);

    // Allowlist del token en ambos routers (requiere que el deployer sea admin)
    if (admin.toLowerCase() === deployer.address.toLowerCase()) {
      await (await treasuryRouter.allowlistToken(tokenAddress)).wait();
      await (await sendRouter.allowlistToken(tokenAddress)).wait();
      console.log("Token allowlisted en ambos routers");
    } else {
      console.log(
        "AVISO: el deployer no es admin; allowlistar el token desde la cuenta admin"
      );
    }
  }

  // 4) (Opcional) allowlist de recipients
  const reserveRecipient = process.env.RESERVE_RECIPIENT;
  const commissionRecipient = process.env.COMMISSION_RECIPIENT;
  if (admin.toLowerCase() === deployer.address.toLowerCase()) {
    if (reserveRecipient && ethers.isAddress(reserveRecipient)) {
      await (await treasuryRouter.allowlistRecipient(reserveRecipient)).wait();
      console.log(`Reserve recipient allowlisted: ${reserveRecipient}`);
    }
    if (commissionRecipient && ethers.isAddress(commissionRecipient)) {
      await (
        await treasuryRouter.allowlistRecipient(commissionRecipient)
      ).wait();
      await (await sendRouter.allowlistRecipient(commissionRecipient)).wait();
      console.log(`Commission recipient allowlisted: ${commissionRecipient}`);
    }
  }

  // 5) Comprobaciones post-deploy (lo que validara ISBE / 0x15Be)
  const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
  for (const [label, router] of [
    ["TreasuryRouterV1", treasuryRouter],
    ["SendRouterV1", sendRouter],
  ] as const) {
    const ok = await router.hasRole(PAUSER_ROLE, isbeGovernance);
    if (!ok) {
      throw new Error(`${label}: la gobernanza ISBE no tiene PAUSER_ROLE`);
    }
    console.log(`${label}: PAUSER_ROLE de ISBE verificado ✔`);
  }

  // 6) Registro del despliegue
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const record = {
    network: network.name,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    admin,
    isbeGovernance,
    contracts: {
      TreasuryRouterV1: treasuryRouterAddress,
      SendRouterV1: sendRouterAddress,
      ...(tokenAddress ? { AccEURMock: tokenAddress } : {}),
    },
    compiler: { solidity: "0.8.28", optimizer: { enabled: true, runs: 200 } },
  };
  const outFile = path.join(deploymentsDir, `${network.name}.json`);
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2));
  console.log("---");
  console.log(`Registro guardado en deployments/${network.name}.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
