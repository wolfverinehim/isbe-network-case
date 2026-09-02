/**
 * Despliegue de AccEURMock (token de pruebas ERC20, 6 decimales) para ISBE.
 *
 * Sustituye al antiguo flujo Python (py-solc-x): usa el mismo toolchain que los
 * routers para mantener la equivalencia bytecode <-> codigo fuente.
 *
 * Variables de entorno (.env):
 *  ADMIN_ADDRESS             DEFAULT_ADMIN_ROLE, MINTER_ROLE y PAUSER_ROLE. Default: deployer
 *  ISBE_GOVERNANCE_ADDRESS   PAUSER_ROLE para ISBE (obligatoria)
 *  TOKEN_NAME / TOKEN_SYMBOL Default: Accuro Euro / AccEUR
 *  INITIAL_MINT / MAX_SUPPLY En unidades humanas (6 decimales). Default: 1000000 / 100000000
 *  MINT_TO                   (opcional) lista de direcciones separadas por coma
 *  MINT_AMOUNT               (opcional) cantidad para cada direccion de MINT_TO. Default: 10000
 *  ALLOWLIST_ROUTERS         "true" para allowlistar el token en los routers desplegados
 *
 * Uso:
 *  npx hardhat run scripts/deploy-token.ts --network isbe
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
const ALLOWLIST_ADMIN_ROLE = ethers.keccak256(
  ethers.toUtf8Bytes("ALLOWLIST_ADMIN_ROLE")
);

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

  const name = process.env.TOKEN_NAME ?? "Accuro Euro";
  const symbol = process.env.TOKEN_SYMBOL ?? "AccEUR";
  const initialMint = ethers.parseUnits(process.env.INITIAL_MINT ?? "1000000", 6);
  const maxSupply = ethers.parseUnits(process.env.MAX_SUPPLY ?? "100000000", 6);

  console.log(`Red:        ${network.name}`);
  console.log(`Deployer:   ${deployer.address}`);
  console.log(`Admin:      ${admin}`);
  console.log(`ISBE gov:   ${isbeGovernance}`);
  console.log("---");

  const Token = await ethers.getContractFactory("AccEURMock");
  const token = await Token.deploy(
    name,
    symbol,
    admin,
    isbeGovernance,
    initialMint,
    maxSupply
  );
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log(`AccEURMock:       ${tokenAddress}`);

  if (!(await token.hasRole(PAUSER_ROLE, isbeGovernance))) {
    throw new Error("La gobernanza ISBE no tiene PAUSER_ROLE en AccEURMock");
  }
  console.log("AccEURMock:       PAUSER_ROLE de ISBE verificado");

  const mintTo = (process.env.MINT_TO ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (mintTo.length > 0) {
    if (!(await token.hasRole(MINTER_ROLE, deployer.address))) {
      console.log("AVISO: el deployer no tiene MINTER_ROLE; mint adicional omitido");
    } else {
      const mintAmount = ethers.parseUnits(process.env.MINT_AMOUNT ?? "10000", 6);
      for (const account of mintTo) {
        if (!ethers.isAddress(account)) {
          throw new Error(`MINT_TO contiene una direccion invalida: ${account}`);
        }
        await (await token.mint(account, mintAmount)).wait();
        console.log(`Minteados ${process.env.MINT_AMOUNT ?? "10000"} ${symbol} -> ${account}`);
      }
    }
  }

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const outFile = path.join(deploymentsDir, `${network.name}.json`);
  const existing = fs.existsSync(outFile)
    ? JSON.parse(fs.readFileSync(outFile, "utf8"))
    : {};

  if (process.env.ALLOWLIST_ROUTERS === "true") {
    const routers = ["TreasuryRouterV1", "SendRouterV1", "TreasuryRouterV2", "SendRouterV2"];
    for (const label of routers) {
      const address = existing.contracts?.[label];
      if (!address) continue;
      if ((await ethers.provider.getCode(address)) === "0x") {
        console.log(`${label}: sin codigo en ${address} (registro obsoleto); omitido`);
        continue;
      }
      const router = await ethers.getContractAt(label, address, deployer);
      try {
        if (await router.allowlistedTokens(tokenAddress)) {
          console.log(`${label}: token ya allowlisted`);
          continue;
        }
        if (!(await router.hasRole(ALLOWLIST_ADMIN_ROLE, deployer.address))) {
          console.log(`${label}: el deployer no tiene ALLOWLIST_ADMIN_ROLE; pendiente`);
          continue;
        }
        await (await router.allowlistToken(tokenAddress)).wait();
        console.log(`${label}: token allowlisted`);
      } catch {
        console.log(`${label}: no responde como router en ${address}; omitido`);
      }
    }
  }

  const record = {
    ...existing,
    network: network.name,
    timestamp: new Date().toISOString(),
    admin,
    isbeGovernance,
    contracts: {
      ...(existing.contracts ?? {}),
      AccEURMock: tokenAddress,
    },
    compiler: { solidity: "0.8.28", optimizer: { enabled: true, runs: 200 } },
  };
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2));
  console.log(`Registro actualizado en deployments/${network.name}.json`);

  console.log("---");
  console.log(`NEXT_PUBLIC_USDT_CONTRACT=${tokenAddress}`);
  console.log(`FUNDING_ROUTER_USDT_CONTRACT=${tokenAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
