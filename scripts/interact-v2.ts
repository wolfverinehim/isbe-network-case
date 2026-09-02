import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [signer] = await ethers.getSigners();
  const record = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "deployments", `${network.name}.json`),
      "utf8"
    )
  );
  const treasury = await ethers.getContractAt(
    "TreasuryRouterV2",
    record.contracts.TreasuryRouterV2,
    signer
  );
  const send = await ethers.getContractAt(
    "SendRouterV2",
    record.contracts.SendRouterV2,
    signer
  );
  const token = await ethers.getContractAt(
    "AccEURMock",
    record.contracts.AccEURMockV2 ?? record.contracts.AccEURMock,
    signer
  );

  const reserve = process.env.RESERVE_RECIPIENT;
  const commission = process.env.COMMISSION_RECIPIENT;
  if (!reserve || !commission) throw new Error("Faltan recipients en .env");

  const referralBeneficiary = ethers.Wallet.createRandom().address;
  await (await treasury.allowlistRecipient(await treasury.getAddress())).wait();
  await (await treasury.setReleaseExecutor(signer.address, true)).wait();
  await (
    await treasury.setReferralFallbackCommissionWallet(commission)
  ).wait();

  const total = ethers.parseUnits("156", 6);
  await (await token.mint(signer.address, total)).wait();
  await (await token.approve(await treasury.getAddress(), total)).wait();
  await (
    await token.approve(await send.getAddress(), ethers.parseUnits("51", 6))
  ).wait();

  const block = await ethers.provider.getBlock("latest");
  const deadline = (block?.timestamp ?? Math.floor(Date.now() / 1000)) + 3600;
  const reserveAmount = ethers.parseUnits("100", 6);
  const commissionAmount = ethers.parseUnits("5", 6);
  const referralAmount = ethers.parseUnits("10", 6);
  const fundingGroup = ethers.keccak256(ethers.toUtf8Bytes(`v2-funding-${Date.now()}`));
  const funding = {
    groupId: fundingGroup,
    payer: signer.address,
    token: await token.getAddress(),
    reserveRecipient: reserve,
    commissionRecipient: commission,
    referralRecipient: await treasury.getAddress(),
    principalAmount: reserveAmount,
    commissionAmount,
    referralAmount,
    deadline,
    nonce: await treasury.payerNonces(signer.address),
  };
  const [canFund, fundReason] = await treasury.canRouteWithReferral(funding);
  if (!canFund) throw new Error(`canRouteWithReferral fallo: ${fundReason}`);
  await (await treasury.routeFundingWithReferral(funding)).wait();
  const escrow = await treasury.referralEscrowBalance(
    fundingGroup,
    signer.address,
    await token.getAddress()
  );
  if (escrow !== referralAmount) throw new Error("Escrow de referral incorrecto");

  const releaseId = ethers.keccak256(ethers.toUtf8Bytes(`v2-release-${Date.now()}`));
  await (
    await treasury.releaseReferralReward(
      releaseId,
      fundingGroup,
      signer.address,
      await token.getAddress(),
      referralBeneficiary,
      referralAmount
    )
  ).wait();
  if ((await token.balanceOf(referralBeneficiary)) !== referralAmount) {
    throw new Error("Reward de referral no recibido");
  }

  const sendAmount = ethers.parseUnits("50", 6);
  const sendCommission = ethers.parseUnits("1", 6);
  const recipient = ethers.Wallet.createRandom().address;
  const sendRequest = {
    groupId: ethers.keccak256(ethers.toUtf8Bytes(`v2-send-${Date.now()}`)),
    payer: signer.address,
    token: await token.getAddress(),
    recipient,
    commissionRecipient: commission,
    amount: sendAmount,
    commissionAmount: sendCommission,
    deadline,
    nonce: await send.payerNonces(signer.address),
  };
  const [canSend, sendReason] = await send.canRouteSend(sendRequest);
  if (!canSend) throw new Error(`canRouteSend fallo: ${sendReason}`);
  await (await send.routeSend(sendRequest)).wait();
  if ((await token.balanceOf(recipient)) !== sendAmount) {
    throw new Error("Transferencia SendRouterV2 incorrecta");
  }

  await (await send.pause()).wait();
  if (!(await send.paused())) throw new Error("SendRouterV2 no se pauso");
  await (await send.unpause()).wait();
  if (await send.paused()) throw new Error("SendRouterV2 no se despauso");

  console.log("TreasuryRouterV2 routeFundingWithReferral: OK");
  console.log("TreasuryRouterV2 escrow y releaseReferralReward: OK");
  console.log("SendRouterV2 routeSend: OK");
  console.log("SendRouterV2 pause/unpause: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
