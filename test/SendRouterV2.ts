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

describe("SendRouterV2", function () {
  async function deployFixture() {
    const [deployer, admin, isbeGov, payer, recipient, commission, other] =
      await ethers.getSigners();
    const Token = await ethers.getContractFactory("AccEURMock", deployer);
    const token = await Token.deploy(
      "Accuro Euro",
      "AccEUR",
      deployer.address,
      isbeGov.address,
      ethers.parseUnits("1000000", 6),
      ethers.parseUnits("100000000", 6)
    );
    const Router = await ethers.getContractFactory("SendRouterV2", deployer);
    const router = await Router.deploy(admin.address, isbeGov.address);
    await token.transfer(payer.address, ethers.parseUnits("10000", 6));
    await token
      .connect(payer)
      .approve(await router.getAddress(), ethers.MaxUint256);
    await router.connect(admin).allowlistToken(await token.getAddress());
    await router.connect(admin).allowlistRecipient(commission.address);
    const validRequest = {
      groupId: ethers.encodeBytes32String("send-v2-1"),
      payer: payer.address,
      token: await token.getAddress(),
      recipient: recipient.address,
      commissionRecipient: commission.address,
      amount: ethers.parseUnits("50", 6),
      commissionAmount: ethers.parseUnits("1", 6),
      deadline: (await time.latest()) + 3600,
      nonce: 0n,
    };
    return { deployer, admin, isbeGov, payer, recipient, commission, other, token, router, validRequest };
  }

  it("asigna roles ISBE y rechaza constructor invalido", async function () {
    const { router, admin, isbeGov } = await loadFixture(deployFixture);
    expect(await router.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    expect(await router.hasRole(ALLOWLIST_ADMIN_ROLE, admin.address)).to.be.true;
    expect(await router.hasRole(PAUSER_ROLE, isbeGov.address)).to.be.true;
    const Router = await ethers.getContractFactory("SendRouterV2");
    await expect(Router.deploy(ethers.ZeroAddress, isbeGov.address)).to.be.revertedWith("Invalid admin");
    await expect(Router.deploy(admin.address, ethers.ZeroAddress)).to.be.revertedWith("Invalid ISBE governance");
  });

  it("permite a la gobernanza pausar y bloquea cuentas sin PAUSER_ROLE", async function () {
    const { router, isbeGov, other, payer, validRequest } = await loadFixture(deployFixture);
    await expect(router.connect(other).pause()).to.be.revertedWith(missingRole(other.address, PAUSER_ROLE));
    await router.connect(isbeGov).pause();
    expect(await router.paused()).to.be.true;
    expect((await router.canRouteSend(validRequest))[1]).to.equal("Routing paused");
    await expect(router.connect(payer).routeSend(validRequest)).to.be.revertedWith("Pausable: paused");
    await router.connect(isbeGov).unpause();
  });

  it("ejecuta routeSend atomico y protege el replay", async function () {
    const { router, token, payer, recipient, commission, validRequest } = await loadFixture(deployFixture);
    await expect(router.connect(payer).routeSend(validRequest)).to.changeTokenBalances(
      token,
      [payer, recipient, commission],
      [-(validRequest.amount + validRequest.commissionAmount), validRequest.amount, validRequest.commissionAmount]
    );
    expect(await router.consumedGroups(validRequest.groupId)).to.be.true;
    expect(await router.payerNonces(payer.address)).to.equal(1n);
    await expect(router.connect(payer).routeSend({ ...validRequest, nonce: 1n })).to.be.revertedWith("Group already processed (replay)");
  });

  it("limita allowlists y rescates al admin correspondiente", async function () {
    const { router, token, admin, other } = await loadFixture(deployFixture);
    await expect(router.connect(other).allowlistToken(await token.getAddress())).to.be.revertedWith(missingRole(other.address, ALLOWLIST_ADMIN_ROLE));
    await expect(router.connect(other).rescueToken(await token.getAddress(), other.address, 1n)).to.be.revertedWith(missingRole(other.address, DEFAULT_ADMIN_ROLE));
  });

  it("bloquea allowlists y rescates cuando esta pausado", async function () {
    const { router, token, admin, isbeGov, other } = await loadFixture(deployFixture);
    await router.connect(isbeGov).pause();
    const tokenAddress = await token.getAddress();

    await expect(router.connect(admin).allowlistToken(tokenAddress)).to.be.revertedWith("Pausable: paused");
    await expect(router.connect(admin).removeTokenFromAllowlist(tokenAddress)).to.be.revertedWith("Pausable: paused");
    await expect(router.connect(admin).allowlistRecipient(other.address)).to.be.revertedWith("Pausable: paused");
    await expect(router.connect(admin).removeRecipientFromAllowlist(other.address)).to.be.revertedWith("Pausable: paused");
    await expect(router.connect(admin).rescueToken(tokenAddress, other.address, 1n)).to.be.revertedWith("Pausable: paused");
    await expect(router.connect(admin).rescueNative(other.address, 1n)).to.be.revertedWith("Pausable: paused");
  });

  it("la pausa no bloquea la gestion de roles (remediacion de claves)", async function () {
    const { router, admin, isbeGov, other } = await loadFixture(deployFixture);
    await router.connect(isbeGov).pause();
    await expect(router.connect(admin).grantRole(ALLOWLIST_ADMIN_ROLE, other.address)).to.emit(router, "RoleGranted");
  });
});
