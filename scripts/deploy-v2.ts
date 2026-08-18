/**
 * Despliegue de los routers V2 compatibles con ISBE Modalidad 2.
 *
 * Uso:
 *   npx hardhat run scripts/deploy-v2.ts --network isbe
 *
 * Variables opcionales:
 *   DEPLOY_MOCK_TOKEN=true  Despliega y allowlista AccEURMock para pruebas.
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const admin = process.env.ADMIN_ADDRESS || deployer.address;
  const isbeGovernance = process.env.ISBE_GOVERNANCE_ADDRESS;

  if (!isbeGovernance || !ethers.isAddress(isbeGovernance)) {
    throw new Error("ISBE_GOVERNANCE_ADDRESS es obligatoria y debe ser valida");
  }
  if (!ethers.isAddress(admin)) {
    throw new Error("ADMIN_ADDRESS no es una direccion valida");
  }

  console.log(`Red:        ${network.name}`);
  console.log(`Deployer:   ${deployer.address}`);
  console.log(`Admin:      ${admin}`);
  console.log(`ISBE gov:   ${isbeGovernance}`);
  console.log("---");

  const TreasuryRouter = await ethers.getContractFactory("TreasuryRouterV2");
  const treasuryRouter = await TreasuryRouter.deploy(admin, isbeGovernance);
  await treasuryRouter.waitForDeployment();
  const treasuryAddress = await treasuryRouter.getAddress();
  console.log(`TreasuryRouterV2: ${treasuryAddress}`);

  const SendRouter = await ethers.getContractFactory("SendRouterV2");
  const sendRouter = await SendRouter.deploy(admin, isbeGovernance);
  await sendRouter.waitForDeployment();
  const sendAddress = await sendRouter.getAddress();
  console.log(`SendRouterV2:     ${sendAddress}`);

  if (admin.toLowerCase() === deployer.address.toLowerCase()) {
    const reserve = process.env.RESERVE_RECIPIENT;
    const commission = process.env.COMMISSION_RECIPIENT;
    if (reserve && ethers.isAddress(reserve)) {
      await (await treasuryRouter.allowlistRecipient(reserve)).wait();
      console.log(`Reserve recipient allowlisted: ${reserve}`);
    }
    if (commission && ethers.isAddress(commission)) {
      await (await treasuryRouter.allowlistRecipient(commission)).wait();
      await (await sendRouter.allowlistRecipient(commission)).wait();
      console.log(`Commission recipient allowlisted: ${commission}`);
    }
  } else {
    console.log("AVISO: el deployer no es admin; las allowlists quedan pendientes");
  }

  let tokenAddress: string | undefined;
  if (process.env.DEPLOY_MOCK_TOKEN === "true") {
    const Token = await ethers.getContractFactory("AccEURMock");
    const token = await Token.deploy(
      process.env.TOKEN_NAME ?? "Accuro Euro V2 Test",
      process.env.TOKEN_SYMBOL ?? "AccEUR2",
      deployer.address,
      ethers.parseUnits(process.env.INITIAL_MINT ?? "1000000", 6),
      ethers.parseUnits(process.env.MAX_SUPPLY ?? "100000000", 6)
    );
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();
    console.log(`AccEURMock:       ${tokenAddress}`);

    if (admin.toLowerCase() === deployer.address.toLowerCase()) {
      await (await treasuryRouter.allowlistToken(tokenAddress)).wait();
      await (await sendRouter.allowlistToken(tokenAddress)).wait();
      console.log("Token allowlisted en ambos routers");
    }
  }

  const pauserRole = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
  const treasuryHasRole = await treasuryRouter.hasRole(pauserRole, isbeGovernance);
  const sendHasRole = await sendRouter.hasRole(pauserRole, isbeGovernance);
  if (!treasuryHasRole || !sendHasRole) {
    throw new Error("La gobernanza ISBE no tiene PAUSER_ROLE en ambos routers V2");
  }
  console.log("TreasuryRouterV2: PAUSER_ROLE de ISBE verificado");
  console.log("SendRouterV2:     PAUSER_ROLE de ISBE verificado");

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const outFile = path.join(deploymentsDir, `${network.name}.json`);
  const existing = fs.existsSync(outFile)
    ? JSON.parse(fs.readFileSync(outFile, "utf8"))
    : {};
  const record = {
    ...existing,
    network: network.name,
    timestamp: new Date().toISOString(),
    admin,
    isbeGovernance,
    contracts: {
      ...(existing.contracts ?? {}),
      TreasuryRouterV2: treasuryAddress,
      SendRouterV2: sendAddress,
      ...(tokenAddress ? { AccEURMockV2: tokenAddress } : {}),
    },
    compiler: { solidity: "0.8.28", optimizer: { enabled: true, runs: 200 } },
  };
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2));
  console.log(`Registro actualizado en deployments/${network.name}.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
