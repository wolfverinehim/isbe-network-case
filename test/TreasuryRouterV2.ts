import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
const ALLOWLIST_ADMIN_ROLE = ethers.keccak256(
  ethers.toUtf8Bytes("ALLOWLIST_ADMIN_ROLE")
);
const missingRole = (account: string, role: string) =>
  `AccessControl: account ${account.toLowerCase()} is missing role ${role}`;

describe("TreasuryRouterV2", function () {
  async function deployFixture() {
    const [deployer, admin, isbeGov, payer, reserve, commission, referral, beneficiary, other] =
      await ethers.getSigners();
    const Token = await ethers.getContractFactory("AccEURMock", deployer);
    const token = await Token.deploy(
      "Accuro Euro",
      "AccEUR",
      deployer.address,
      ethers.parseUnits("1000000", 6),
      ethers.parseUnits("100000000", 6)
    );
    const Router = await ethers.getContractFactory("TreasuryRouterV2", deployer);
    const router = await Router.deploy(admin.address, isbeGov.address);
    await token.transfer(payer.address, ethers.parseUnits("10000", 6));
    await token.connect(payer).approve(await router.getAddress(), ethers.MaxUint256);
    await router.connect(admin).allowlistToken(await token.getAddress());
    await router.connect(admin).allowlistRecipient(reserve.address);
    await router.connect(admin).allowlistRecipient(commission.address);
    await router.connect(admin).allowlistRecipient(referral.address);
    const validRequest = {
      groupId: ethers.encodeBytes32String("funding-v2-1"),
      payer: payer.address,
      token: await token.getAddress(),
      reserveRecipient: reserve.address,
      commissionRecipient: commission.address,
      principalAmount: ethers.parseUnits("100", 6),
      commissionAmount: ethers.parseUnits("5", 6),
      deadline: (await time.latest()) + 3600,
      nonce: 0n,
    };
    return { deployer, admin, isbeGov, payer, reserve, commission, referral, beneficiary, other, token, router, validRequest };
  }

  it("asigna roles ISBE y no da roles de gestion a la gobernanza", async function () {
    const { router, admin, isbeGov } = await loadFixture(deployFixture);
    expect(await router.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    expect(await router.hasRole(ALLOWLIST_ADMIN_ROLE, admin.address)).to.be.true;
    expect(await router.hasRole(PAUSER_ROLE, isbeGov.address)).to.be.true;
    expect(await router.hasRole(DEFAULT_ADMIN_ROLE, isbeGov.address)).to.be.false;
    expect(await router.hasRole(ALLOWLIST_ADMIN_ROLE, isbeGov.address)).to.be.false;
  });

  it("pausa mediante gobernanza y rechaza pausas sin rol", async function () {
    const { router, isbeGov, other, validRequest } = await loadFixture(deployFixture);
    await expect(router.connect(other).pause()).to.be.revertedWith(missingRole(other.address, PAUSER_ROLE));
    await router.connect(isbeGov).pause();
    expect(await router.paused()).to.be.true;
    expect((await router.canRoute(validRequest))[1]).to.equal("Routing paused");
    await router.connect(isbeGov).unpause();
  });

  it("ejecuta el split base y conserva atomicidad ante allowance insuficiente", async function () {
    const { router, token, payer, reserve, validRequest } = await loadFixture(deployFixture);
    await token.connect(payer).approve(await router.getAddress(), validRequest.principalAmount);
    await expect(router.connect(payer).routeFunding(validRequest)).to.be.reverted;
    expect(await token.balanceOf(reserve.address)).to.equal(0n);
    expect(await router.payerNonces(payer.address)).to.equal(0n);
  });

  it("financia escrow y libera reward una sola vez", async function () {
    const { router, token, admin, payer, reserve, commission, referral, beneficiary } = await loadFixture(deployFixture);
    await router.connect(admin).allowlistRecipient(await router.getAddress());
    await router.connect(admin).setReleaseExecutor(admin.address, true);
    await router.connect(admin).setReferralFallbackCommissionWallet(commission.address);
    const referralAmount = ethers.parseUnits("10", 6);
    const groupId = ethers.encodeBytes32String("referral-v2-1");
    const request = {
      groupId,
      payer: payer.address,
      token: await token.getAddress(),
      reserveRecipient: reserve.address,
      commissionRecipient: commission.address,
      referralRecipient: await router.getAddress(),
      principalAmount: ethers.parseUnits("100", 6),
      commissionAmount: ethers.parseUnits("5", 6),
      referralAmount,
      deadline: (await time.latest()) + 3600,
      nonce: 0n,
    };
    const [ok, reason] = await router.canRouteWithReferral(request);
    expect(ok).to.be.true;
    expect(reason).to.equal("Can route with referral");
    await router.connect(payer).routeFundingWithReferral(request);
    expect(await router.referralEscrowBalance(groupId, payer.address, await token.getAddress())).to.equal(referralAmount);
    const releaseId = ethers.encodeBytes32String("release-v2-1");
    await router.connect(admin).releaseReferralReward(releaseId, groupId, payer.address, await token.getAddress(), beneficiary.address, referralAmount);
    expect(await token.balanceOf(beneficiary.address)).to.equal(referralAmount);
    await expect(router.connect(admin).releaseReferralReward(releaseId, groupId, payer.address, await token.getAddress(), beneficiary.address, 1n)).to.be.revertedWith("Release id already processed");
  });

  it("restringe ejecutores y configuración administrativa", async function () {
    const { router, other, commission } = await loadFixture(deployFixture);
    await expect(router.connect(other).setReleaseExecutor(other.address, true)).to.be.revertedWith(missingRole(other.address, DEFAULT_ADMIN_ROLE));
    await expect(router.connect(other).setReferralFallbackCommissionWallet(commission.address)).to.be.revertedWith(missingRole(other.address, DEFAULT_ADMIN_ROLE));
    await expect(router.connect(other).releaseReferralReward(ethers.ZeroHash, ethers.ZeroHash, other.address, ethers.ZeroAddress, other.address, 1n)).to.be.revertedWith("Caller is not release executor");
  });

  it("bloquea allowlists, configuracion critica y retirada de emergencia cuando esta pausado", async function () {
    const { router, token, admin, isbeGov, other, commission } = await loadFixture(deployFixture);
    await router.connect(isbeGov).pause();
    const tokenAddress = await token.getAddress();

    await expect(router.connect(admin).allowlistToken(tokenAddress)).to.be.revertedWith("Pausable: paused");
    await expect(router.connect(admin).removeTokenFromAllowlist(tokenAddress)).to.be.revertedWith("Pausable: paused");
    await expect(router.connect(admin).allowlistRecipient(other.address)).to.be.revertedWith("Pausable: paused");
    await expect(router.connect(admin).removeRecipientFromAllowlist(other.address)).to.be.revertedWith("Pausable: paused");
    await expect(router.connect(admin).setReleaseExecutor(other.address, true)).to.be.revertedWith("Pausable: paused");
    await expect(router.connect(admin).setReferralFallbackCommissionWallet(commission.address)).to.be.revertedWith("Pausable: paused");
    await expect(router.connect(admin).emergencyWithdrawToken(tokenAddress, other.address, 1n)).to.be.revertedWith("Pausable: paused");
  });

  it("la pausa no bloquea la gestion de roles (remediacion de claves)", async function () {
    const { router, admin, isbeGov, other } = await loadFixture(deployFixture);
    await router.connect(isbeGov).pause();
    await expect(router.connect(admin).grantRole(ALLOWLIST_ADMIN_ROLE, other.address)).to.emit(router, "RoleGranted");
  });
});
