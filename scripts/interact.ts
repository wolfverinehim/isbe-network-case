/**
 * Script de pruebas de transacciones contra los routers desplegados.
 *
 * Flujo:
 *  1. Carga direcciones de deployments/<red>.json (o de env)
 *  2. Token: usa TOKEN_ADDRESS o despliega un AccEURMock de pruebas
 *  3. Configura allowlists si el signer tiene ALLOWLIST_ADMIN_ROLE
 *  4. Prueba routeFunding (TreasuryRouterV1) y routeSend (SendRouterV1)
 *  5. Verifica balances y muestra resultados
 *
 * Variables de entorno (todas opcionales):
 *  TREASURY_ROUTER_ADDRESS / SEND_ROUTER_ADDRESS   (default: deployments/<red>.json)
 *  TOKEN_ADDRESS          token ERC20 a usar (default: despliega AccEURMock)
 *  RESERVE_RECIPIENT      (default: direccion aleatoria de prueba)
 *  COMMISSION_RECIPIENT   (default: direccion aleatoria de prueba)
 *  RECIPIENT              destinatario del send P2P (default: direccion aleatoria)
 *
 * Uso:
 *  npx hardhat run scripts/interact.ts --network isbe
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const ALLOWLIST_ADMIN_ROLE = ethers.keccak256(
  ethers.toUtf8Bytes("ALLOWLIST_ADMIN_ROLE")
);

const fmt = (v: bigint) => ethers.formatUnits(v, 6);

async function main() {
  const [signer] = await ethers.getSigners();
  console.log(`Red:    ${network.name}`);
  console.log(`Signer: ${signer.address}`);
  console.log("---");

  // 1) Direcciones de los routers
  const recordPath = path.join(
    __dirname,
    "..",
    "deployments",
    `${network.name}.json`
  );
  let record: any = {};
  if (fs.existsSync(recordPath)) {
    record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  }

  let treasuryAddress =
    process.env.TREASURY_ROUTER_ADDRESS ?? record.contracts?.TreasuryRouterV1;
  let sendAddress =
    process.env.SEND_ROUTER_ADDRESS ?? record.contracts?.SendRouterV1;

  // Modo smoke-test local: sin despliegue previo, despliega todo
  if (!treasuryAddress || !sendAddress) {
    if (network.name === "hardhat" || network.name === "localhost") {
      console.log("Sin despliegue previo: desplegando routers de prueba...");
      const T = await ethers.getContractFactory("TreasuryRouterV1");
      const t = await T.deploy(signer.address, signer.address);
      treasuryAddress = await t.getAddress();
      const S = await ethers.getContractFactory("SendRouterV1");
      const s = await S.deploy(signer.address, signer.address);
      sendAddress = await s.getAddress();
    } else {
      throw new Error(
        `No hay deployments/${network.name}.json ni TREASURY_ROUTER_ADDRESS/SEND_ROUTER_ADDRESS`
      );
    }
  }

  const treasury = await ethers.getContractAt(
    "TreasuryRouterV1",
    treasuryAddress,
    signer
  );
  const sendRouter = await ethers.getContractAt(
    "SendRouterV1",
    sendAddress,
    signer
  );
  console.log(`TreasuryRouterV1: ${treasuryAddress}`);
  console.log(`SendRouterV1:     ${sendAddress}`);
  console.log(`Pausado (treasury/send): ${await treasury.paused()} / ${await sendRouter.paused()}`);

  // 2) Token
  let tokenAddress = process.env.TOKEN_ADDRESS ?? record.contracts?.AccEURMock;
  let token;
  if (tokenAddress) {
    token = await ethers.getContractAt("AccEURMock", tokenAddress, signer);
    console.log(`Token existente:  ${tokenAddress}`);
  } else {
    console.log("Sin TOKEN_ADDRESS: desplegando AccEURMock de pruebas...");
    const Token = await ethers.getContractFactory("AccEURMock", signer);
    token = await Token.deploy(
      "Accuro Euro Test",
      "AccEUR",
      signer.address,
      record.isbeGovernance ?? signer.address,
      ethers.parseUnits("1000000", 6),
      ethers.parseUnits("100000000", 6)
    );
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();
    console.log(`AccEURMock:       ${tokenAddress}`);
  }

  // Recipients de prueba
  const reserve =
    process.env.RESERVE_RECIPIENT ?? ethers.Wallet.createRandom().address;
  const commission =
    process.env.COMMISSION_RECIPIENT ?? ethers.Wallet.createRandom().address;
  const recipient =
    process.env.RECIPIENT ?? ethers.Wallet.createRandom().address;
  console.log(`Reserve:          ${reserve}`);
  console.log(`Commission:       ${commission}`);
  console.log(`Recipient (P2P):  ${recipient}`);
  console.log("---");

  // 3) Allowlists (idempotente; requiere ALLOWLIST_ADMIN_ROLE)
  const isAllowlistAdmin = await treasury.hasRole(
    ALLOWLIST_ADMIN_ROLE,
    signer.address
  );
  for (const [label, router, recips] of [
    ["TreasuryRouterV1", treasury, [reserve, commission]],
    ["SendRouterV1", sendRouter, [commission]],
  ] as const) {
    const pending: string[] = [];
    if (!(await router.allowlistedTokens(tokenAddress))) {
      pending.push("token");
    }
    for (const r of recips) {
      if (!(await router.allowlistedRecipients(r))) pending.push(r);
    }
    if (pending.length === 0) {
      console.log(`${label}: allowlists OK`);
      continue;
    }
    if (!isAllowlistAdmin) {
      throw new Error(
        `${label}: faltan allowlists (${pending.join(", ")}) y el signer no tiene ALLOWLIST_ADMIN_ROLE.\n` +
          `Ejecuta el allowlisting desde la cuenta admin (${record.admin ?? "ver despliegue"}).`
      );
    }
    if (!(await router.allowlistedTokens(tokenAddress))) {
      await (await router.allowlistToken(tokenAddress)).wait();
      console.log(`${label}: token allowlisted`);
    }
    for (const r of recips) {
      if (!(await router.allowlistedRecipients(r))) {
        await (await router.allowlistRecipient(r)).wait();
        console.log(`${label}: recipient allowlisted ${r}`);
      }
    }
  }

  // 4) Balance y allowance del payer (signer)
  const principal = ethers.parseUnits("100", 6);
  const fundingCommission = ethers.parseUnits("5", 6);
  const sendAmount = ethers.parseUnits("50", 6);
  const sendCommission = ethers.parseUnits("1", 6);
  const totalNeeded =
    principal + fundingCommission + sendAmount + sendCommission;

  let balance = await token.balanceOf(signer.address);
  if (balance < totalNeeded) {
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    if (await token.hasRole(MINTER_ROLE, signer.address)) {
      await (await token.mint(signer.address, totalNeeded)).wait();
      console.log(`Minteados ${fmt(totalNeeded)} AccEUR al payer`);
      balance = await token.balanceOf(signer.address);
    } else {
      throw new Error(
        `Balance insuficiente (${fmt(balance)}) y el signer no tiene MINTER_ROLE en el token`
      );
    }
  }
  console.log(`Balance payer: ${fmt(balance)}`);

  for (const [router, needed] of [
    [treasuryAddress, principal + fundingCommission],
    [sendAddress, sendAmount + sendCommission],
  ] as const) {
    const current = await token.allowance(signer.address, router);
    if (current < needed) {
      await (await token.approve(router, needed)).wait();
      console.log(`Approve de ${fmt(needed)} a ${router}`);
    }
  }
  console.log("---");

  const block = await ethers.provider.getBlock("latest");
  const deadline = (block?.timestamp ?? Math.floor(Date.now() / 1000)) + 3600;

  // 5) routeFunding
  console.log("== Prueba 1: TreasuryRouterV1.routeFunding ==");
  const fundingReq = {
    groupId: ethers.keccak256(ethers.toUtf8Bytes(`funding-${Date.now()}`)),
    payer: signer.address,
    token: tokenAddress,
    reserveRecipient: reserve,
    commissionRecipient: commission,
    principalAmount: principal,
    commissionAmount: fundingCommission,
    deadline,
    nonce: await treasury.payerNonces(signer.address),
  };

  const [canR, reasonR] = await treasury.canRoute(fundingReq);
  console.log(`canRoute: ${canR} (${reasonR})`);
  if (!canR) throw new Error(`canRoute fallo: ${reasonR}`);

  const tx1 = await treasury.routeFunding(fundingReq);
  const rc1 = await tx1.wait();
  console.log(`tx: ${rc1?.hash} (bloque ${rc1?.blockNumber}, gas ${rc1?.gasUsed})`);
  console.log(`Reserve balance:    ${fmt(await token.balanceOf(reserve))}`);
  console.log(`Commission balance: ${fmt(await token.balanceOf(commission))}`);
  console.log("---");

  // 6) routeSend
  console.log("== Prueba 2: SendRouterV1.routeSend ==");
  const sendReq = {
    groupId: ethers.keccak256(ethers.toUtf8Bytes(`send-${Date.now()}`)),
    payer: signer.address,
    token: tokenAddress,
    recipient,
    commissionRecipient: commission,
    amount: sendAmount,
    commissionAmount: sendCommission,
    deadline,
    nonce: await sendRouter.payerNonces(signer.address),
  };

  const [canS, reasonS] = await sendRouter.canRouteSend(sendReq);
  console.log(`canRouteSend: ${canS} (${reasonS})`);
  if (!canS) throw new Error(`canRouteSend fallo: ${reasonS}`);

  const tx2 = await sendRouter.routeSend(sendReq);
  const rc2 = await tx2.wait();
  console.log(`tx: ${rc2?.hash} (bloque ${rc2?.blockNumber}, gas ${rc2?.gasUsed})`);
  console.log(`Recipient balance:  ${fmt(await token.balanceOf(recipient))}`);
  console.log(`Commission balance: ${fmt(await token.balanceOf(commission))}`);
  console.log("---");

  // 7) Comprobacion anti-replay
  console.log("== Prueba 3: anti-replay (debe fallar) ==");
  const [replayOk, replayReason] = await treasury.canRoute({
    ...fundingReq,
    nonce: await treasury.payerNonces(signer.address),
  });
  console.log(
    `canRoute con groupId repetido: ${replayOk} (${replayReason}) ${
      !replayOk ? "✔" : "✘ ERROR"
    }`
  );

  console.log("---");
  console.log("Pruebas completadas ✔");
  console.log(`Balance final payer: ${fmt(await token.balanceOf(signer.address))}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
