import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

type StoredWallet = {
  role: string;
  address: string;
  privateKey: string;
};

const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function mint(address,uint256)",
];

function walletByRole(wallets: StoredWallet[], role: string): StoredWallet {
  const wallet = wallets.find((entry) => entry.role === role);
  if (!wallet) throw new Error(`Falta la wallet con rol ${role}`);
  return wallet;
}

async function main() {
  const [admin] = await ethers.getSigners();
  const walletFile = process.env.PRE_WALLETS_FILE;
  if (!walletFile) throw new Error("PRE_WALLETS_FILE es obligatoria");

  const walletData = JSON.parse(
    fs.readFileSync(path.resolve(walletFile), "utf8")
  ) as { wallets: StoredWallet[] };

  const payerData = walletByRole(walletData.wallets, "payerTest");
  const executorData = walletByRole(walletData.wallets, "releaseExecutor");
  const reserveData = walletByRole(walletData.wallets, "reserveRecipient");
  const commissionData = walletByRole(walletData.wallets, "commissionRecipient");
  const referralData = walletByRole(walletData.wallets, "referralRecipient");
  const p2pData = walletByRole(walletData.wallets, "p2pRecipientTest");

  const payer = new ethers.Wallet(payerData.privateKey, ethers.provider);
  const executor = new ethers.Wallet(executorData.privateKey, ethers.provider);

  const tokenAddress = process.env.TOKENS?.split(",")[0]?.trim();
  const treasuryAddress = process.env.TREASURY_ROUTER_V2;
  const sendAddress = process.env.SEND_ROUTER_V2;
  if (!tokenAddress || !treasuryAddress || !sendAddress) {
    throw new Error("Faltan TOKENS, TREASURY_ROUTER_V2 o SEND_ROUTER_V2");
  }

  const tokenAdmin = new ethers.Contract(tokenAddress, TOKEN_ABI, admin);
  const tokenPayer = tokenAdmin.connect(payer);
  const treasury = await ethers.getContractAt(
    "TreasuryRouterV2",
    treasuryAddress,
    payer
  );
  const treasuryExecutor = treasury.connect(executor);
  const send = await ethers.getContractAt("SendRouterV2", sendAddress, payer);

  const targetBalance = ethers.parseUnits("1000", 6);
  const payerBalance = await tokenAdmin.balanceOf(payer.address);
  if (payerBalance < targetBalance) {
    const mintTx = await tokenAdmin.mint(payer.address, targetBalance - payerBalance);
    await mintTx.wait();
    console.log(`Mint: ${ethers.formatUnits(targetBalance - payerBalance, 6)} AccEUR (${mintTx.hash})`);
  }

  const treasuryAmount = ethers.parseUnits("115", 6);
  const sendAmountTotal = ethers.parseUnits("51", 6);
  if ((await tokenAdmin.allowance(payer.address, treasuryAddress)) < treasuryAmount) {
    const approveTx = await tokenPayer.approve(treasuryAddress, treasuryAmount);
    await approveTx.wait();
    console.log(`Approve TreasuryRouterV2: ${approveTx.hash}`);
  }
  if ((await tokenAdmin.allowance(payer.address, sendAddress)) < sendAmountTotal) {
    const approveTx = await tokenPayer.approve(sendAddress, sendAmountTotal);
    await approveTx.wait();
    console.log(`Approve SendRouterV2: ${approveTx.hash}`);
  }

  const latest = await ethers.provider.getBlock("latest");
  const deadline = (latest?.timestamp ?? Math.floor(Date.now() / 1000)) + 3600;
  const suffix = `${Date.now()}-${payer.address}`;
  const fundingGroup = ethers.keccak256(
    ethers.toUtf8Bytes(`pre-funding-${suffix}`)
  );
  const referralAmount = ethers.parseUnits("10", 6);
  const funding = {
    groupId: fundingGroup,
    payer: payer.address,
    token: tokenAddress,
    reserveRecipient: reserveData.address,
    commissionRecipient: commissionData.address,
    referralRecipient: treasuryAddress,
    principalAmount: ethers.parseUnits("100", 6),
    commissionAmount: ethers.parseUnits("5", 6),
    referralAmount,
    deadline,
    nonce: await treasury.payerNonces(payer.address),
  };

  const [canFund, fundReason] = await treasury.canRouteWithReferral(funding);
  if (!canFund) throw new Error(`canRouteWithReferral: ${fundReason}`);
  const fundingTx = await treasury.routeFundingWithReferral(funding);
  await fundingTx.wait();
  console.log(`Funding con escrow: ${fundingTx.hash}`);

  const escrow = await treasury.referralEscrowBalance(
    fundingGroup,
    payer.address,
    tokenAddress
  );
  if (escrow !== referralAmount) throw new Error("Saldo de escrow incorrecto");

  const beneficiaryBefore = await tokenAdmin.balanceOf(referralData.address);
  const releaseId = ethers.keccak256(
    ethers.toUtf8Bytes(`pre-release-${suffix}`)
  );
  const releaseTx = await treasuryExecutor.releaseReferralReward(
    releaseId,
    fundingGroup,
    payer.address,
    tokenAddress,
    referralData.address,
    referralAmount
  );
  await releaseTx.wait();
  console.log(`Release de escrow: ${releaseTx.hash}`);

  const beneficiaryAfter = await tokenAdmin.balanceOf(referralData.address);
  if (beneficiaryAfter - beneficiaryBefore !== referralAmount) {
    throw new Error("El beneficiario no recibio el referral esperado");
  }

  const p2pBefore = await tokenAdmin.balanceOf(p2pData.address);
  const sendRequest = {
    groupId: ethers.keccak256(ethers.toUtf8Bytes(`pre-send-${suffix}`)),
    payer: payer.address,
    token: tokenAddress,
    recipient: p2pData.address,
    commissionRecipient: commissionData.address,
    amount: ethers.parseUnits("50", 6),
    commissionAmount: ethers.parseUnits("1", 6),
    deadline,
    nonce: await send.payerNonces(payer.address),
  };

  const [canSend, sendReason] = await send.canRouteSend(sendRequest);
  if (!canSend) throw new Error(`canRouteSend: ${sendReason}`);
  const sendTx = await send.routeSend(sendRequest);
  await sendTx.wait();
  console.log(`Send P2P: ${sendTx.hash}`);

  const p2pAfter = await tokenAdmin.balanceOf(p2pData.address);
  if (p2pAfter - p2pBefore !== sendRequest.amount) {
    throw new Error("El recipient P2P no recibio el importe esperado");
  }

  console.log("---");
  console.log(`payerTest restante: ${ethers.formatUnits(await tokenAdmin.balanceOf(payer.address), 6)} AccEUR`);
  console.log("Smoke V2 pre: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
