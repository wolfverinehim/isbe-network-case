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

describe("SendRouterV1", function () {
  async function deployFixture() {
    const [deployer, admin, isbeGov, payer, recipient, commission, other] =
      await ethers.getSigners();

    const Token = await ethers.getContractFactory("AccEURMock", deployer);
    const token = await Token.deploy(
      "Accuro Euro",
      "AccEUR",
      deployer.address,
      ethers.parseUnits("1000000", 6),
      ethers.parseUnits("100000000", 6)
    );

    const Router = await ethers.getContractFactory("SendRouterV1", deployer);
    const router = await Router.deploy(admin.address, isbeGov.address);

    await token.transfer(payer.address, ethers.parseUnits("10000", 6));
    await token
      .connect(payer)
      .approve(await router.getAddress(), ethers.MaxUint256);

    await router.connect(admin).allowlistToken(await token.getAddress());
    // Solo el commissionRecipient necesita allowlist (recipient es dinamico)
    await router.connect(admin).allowlistRecipient(commission.address);

    const deadline = (await time.latest()) + 3600;

    const validRequest = {
      groupId: ethers.encodeBytes32String("send-1"),
      payer: payer.address,
      token: await token.getAddress(),
      recipient: recipient.address,
      commissionRecipient: commission.address,
      amount: ethers.parseUnits("50", 6),
      commissionAmount: ethers.parseUnits("1", 6),
      deadline,
      nonce: 0n,
    };

    return {
      token,
      router,
      deployer,
      admin,
      isbeGov,
      payer,
      recipient,
      commission,
      other,
      validRequest,
    };
  }

  describe("Despliegue y roles", function () {
    it("asigna los roles al admin y PAUSER_ROLE a la gobernanza ISBE", async function () {
      const { router, admin, isbeGov } = await loadFixture(deployFixture);
      expect(await router.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
      expect(await router.hasRole(ALLOWLIST_ADMIN_ROLE, admin.address)).to.be
        .true;
      expect(await router.hasRole(PAUSER_ROLE, admin.address)).to.be.true;
      expect(await router.hasRole(PAUSER_ROLE, isbeGov.address)).to.be.true;
      expect(await router.hasRole(DEFAULT_ADMIN_ROLE, isbeGov.address)).to.be
        .false;
    });

    it("revierte con direcciones invalidas en el constructor", async function () {
      const { admin, isbeGov } = await loadFixture(deployFixture);
      const Router = await ethers.getContractFactory("SendRouterV1");
      await expect(
        Router.deploy(ethers.ZeroAddress, isbeGov.address)
      ).to.be.revertedWith("Invalid admin");
      await expect(
        Router.deploy(admin.address, ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid ISBE governance");
    });
  });

  describe("Pausabilidad (requisito ISBE)", function () {
    it("la gobernanza de ISBE puede pausar y despausar", async function () {
      const { router, isbeGov } = await loadFixture(deployFixture);
      await expect(router.connect(isbeGov).pause())
        .to.emit(router, "Paused")
        .withArgs(isbeGov.address);
      await expect(router.connect(isbeGov).unpause())
        .to.emit(router, "Unpaused")
        .withArgs(isbeGov.address);
    });

    it("una cuenta sin PAUSER_ROLE no puede pausar ni despausar", async function () {
      const { router, isbeGov, other } = await loadFixture(deployFixture);
      const err = missingRole(other.address, PAUSER_ROLE);
      await expect(router.connect(other).pause()).to.be.revertedWith(err);
      await router.connect(isbeGov).pause();
      await expect(router.connect(other).unpause()).to.be.revertedWith(err);
    });

    it("bloquea routeSend cuando esta pausado y lo permite tras despausar", async function () {
      const { router, isbeGov, payer, validRequest } =
        await loadFixture(deployFixture);
      await router.connect(isbeGov).pause();
      await expect(
        router.connect(payer).routeSend(validRequest)
      ).to.be.revertedWith("Pausable: paused");

      const [ok, reason] = await router.canRouteSend(validRequest);
      expect(ok).to.be.false;
      expect(reason).to.equal("Routing paused");

      await router.connect(isbeGov).unpause();
      await expect(router.connect(payer).routeSend(validRequest)).to.emit(
        router,
        "SendRouted"
      );
    });
  });

  describe("Control de acceso (RBAC)", function () {
    it("solo ALLOWLIST_ADMIN_ROLE puede gestionar allowlists", async function () {
      const { router, other, token } = await loadFixture(deployFixture);
      const err = missingRole(other.address, ALLOWLIST_ADMIN_ROLE);
      await expect(
        router.connect(other).allowlistToken(await token.getAddress())
      ).to.be.revertedWith(err);
      await expect(
        router.connect(other).allowlistRecipient(other.address)
      ).to.be.revertedWith(err);
      await expect(
        router.connect(other).removeTokenFromAllowlist(await token.getAddress())
      ).to.be.revertedWith(err);
      await expect(
        router.connect(other).removeRecipientFromAllowlist(other.address)
      ).to.be.revertedWith(err);
    });

    it("el admin puede conceder y revocar roles (rotacion)", async function () {
      const { router, admin, other } = await loadFixture(deployFixture);
      await router
        .connect(admin)
        .grantRole(ALLOWLIST_ADMIN_ROLE, other.address);
      await expect(router.connect(other).allowlistRecipient(other.address)).to
        .not.be.reverted;
      await router
        .connect(admin)
        .revokeRole(ALLOWLIST_ADMIN_ROLE, other.address);
      await expect(
        router.connect(other).allowlistRecipient(other.address)
      ).to.be.revertedWith(missingRole(other.address, ALLOWLIST_ADMIN_ROLE));
    });
  });

  describe("routeSend — happy path", function () {
    it("transfiere amount y comision atomicamente y emite SendRouted", async function () {
      const { router, token, payer, recipient, commission, validRequest } =
        await loadFixture(deployFixture);

      const tx = router.connect(payer).routeSend(validRequest);

      await expect(tx).to.changeTokenBalances(
        token,
        [payer, recipient, commission],
        [
          -(validRequest.amount + validRequest.commissionAmount),
          validRequest.amount,
          validRequest.commissionAmount,
        ]
      );
      await expect(tx).to.emit(router, "SendRouted");
    });

    it("acepta un recipient dinamico (sin allowlist)", async function () {
      const { router, payer, other, validRequest } =
        await loadFixture(deployFixture);
      const req = { ...validRequest, recipient: other.address };
      await expect(router.connect(payer).routeSend(req)).to.emit(
        router,
        "SendRouted"
      );
    });

    it("marca groupId consumido e incrementa nonce", async function () {
      const { router, payer, validRequest } = await loadFixture(deployFixture);
      await router.connect(payer).routeSend(validRequest);
      expect(await router.consumedGroups(validRequest.groupId)).to.be.true;
      expect(await router.payerNonces(payer.address)).to.equal(1n);
    });
  });

  describe("routeSend — validaciones", function () {
    it("revierte si el caller no es el payer", async function () {
      const { router, other, validRequest } = await loadFixture(deployFixture);
      await expect(
        router.connect(other).routeSend(validRequest)
      ).to.be.revertedWith("Caller must be payer");
    });

    it("revierte si la request ha expirado", async function () {
      const { router, payer, validRequest } = await loadFixture(deployFixture);
      await time.increaseTo(validRequest.deadline + 1);
      await expect(
        router.connect(payer).routeSend(validRequest)
      ).to.be.revertedWith("Request expired");
    });

    it("revierte ante replay del mismo groupId", async function () {
      const { router, payer, validRequest } = await loadFixture(deployFixture);
      await router.connect(payer).routeSend(validRequest);
      await expect(
        router.connect(payer).routeSend({ ...validRequest, nonce: 1n })
      ).to.be.revertedWith("Group already processed (replay)");
    });

    it("revierte con nonce invalido", async function () {
      const { router, payer, validRequest } = await loadFixture(deployFixture);
      await expect(
        router.connect(payer).routeSend({ ...validRequest, nonce: 7n })
      ).to.be.revertedWith("Invalid nonce");
    });

    it("revierte con token no allowlisted", async function () {
      const { router, admin, payer, token, validRequest } =
        await loadFixture(deployFixture);
      await router
        .connect(admin)
        .removeTokenFromAllowlist(await token.getAddress());
      await expect(
        router.connect(payer).routeSend(validRequest)
      ).to.be.revertedWith("Token not allowlisted");
    });

    it("revierte con commissionRecipient no allowlisted", async function () {
      const { router, admin, payer, commission, validRequest } =
        await loadFixture(deployFixture);
      await router
        .connect(admin)
        .removeRecipientFromAllowlist(commission.address);
      await expect(
        router.connect(payer).routeSend(validRequest)
      ).to.be.revertedWith("Commission recipient not allowlisted");
    });

    it("revierte con importes a cero", async function () {
      const { router, payer, validRequest } = await loadFixture(deployFixture);
      await expect(
        router.connect(payer).routeSend({ ...validRequest, amount: 0n })
      ).to.be.revertedWith("Amount must be > 0");
      await expect(
        router
          .connect(payer)
          .routeSend({ ...validRequest, commissionAmount: 0n })
      ).to.be.revertedWith("Commission must be > 0");
    });

    it("revierte con recipient invalido o igual al commissionRecipient", async function () {
      const { router, payer, commission, validRequest } =
        await loadFixture(deployFixture);
      await expect(
        router
          .connect(payer)
          .routeSend({ ...validRequest, recipient: ethers.ZeroAddress })
      ).to.be.revertedWith("Invalid recipient");
      await expect(
        router
          .connect(payer)
          .routeSend({ ...validRequest, recipient: commission.address })
      ).to.be.revertedWith("Recipient cannot be commission recipient");
    });
  });

  describe("Atomicidad (all or nothing)", function () {
    it("revierte todo si no hay allowance para la comision", async function () {
      const { router, token, payer, recipient, validRequest } =
        await loadFixture(deployFixture);
      await token
        .connect(payer)
        .approve(await router.getAddress(), validRequest.amount);

      const recipientBefore = await token.balanceOf(recipient.address);
      await expect(router.connect(payer).routeSend(validRequest)).to.be
        .reverted;
      expect(await token.balanceOf(recipient.address)).to.equal(
        recipientBefore
      );
      expect(await router.consumedGroups(validRequest.groupId)).to.be.false;
      expect(await router.payerNonces(payer.address)).to.equal(0n);
    });
  });

  describe("canRouteSend", function () {
    it("devuelve true para una request valida", async function () {
      const { router, validRequest } = await loadFixture(deployFixture);
      const [ok, reason] = await router.canRouteSend(validRequest);
      expect(ok).to.be.true;
      expect(reason).to.equal("Can route send");
    });

    it("refleja las validaciones principales", async function () {
      const { router, payer, validRequest } = await loadFixture(deployFixture);
      let [ok, reason] = await router.canRouteSend({
        ...validRequest,
        nonce: 2n,
      });
      expect(ok).to.be.false;
      expect(reason).to.equal("Invalid nonce");

      await router.connect(payer).routeSend(validRequest);
      [ok, reason] = await router.canRouteSend({ ...validRequest, nonce: 1n });
      expect(ok).to.be.false;
      expect(reason).to.equal("Group already processed");
    });
  });

  describe("Pausabilidad de funciones administrativas (Modalidad 2)", function () {
    it("bloquea la gestion de allowlists cuando esta pausado", async function () {
      const { router, admin, isbeGov, token, commission } = await loadFixture(
        deployFixture
      );
      await router.connect(isbeGov).pause();
      const tokenAddress = await token.getAddress();

      await expect(
        router.connect(admin).allowlistToken(tokenAddress)
      ).to.be.revertedWith("Pausable: paused");
      await expect(
        router.connect(admin).removeTokenFromAllowlist(tokenAddress)
      ).to.be.revertedWith("Pausable: paused");
      await expect(
        router.connect(admin).allowlistRecipient(commission.address)
      ).to.be.revertedWith("Pausable: paused");
      await expect(
        router.connect(admin).removeRecipientFromAllowlist(commission.address)
      ).to.be.revertedWith("Pausable: paused");
    });

    it("permite gestionar allowlists de nuevo tras despausar", async function () {
      const { router, admin, isbeGov, other } = await loadFixture(deployFixture);
      await router.connect(isbeGov).pause();
      await router.connect(isbeGov).unpause();
      await expect(router.connect(admin).allowlistRecipient(other.address))
        .to.emit(router, "RecipientAllowlisted")
        .withArgs(other.address);
    });

    it("la pausa no bloquea la gestion de roles (remediacion de claves)", async function () {
      const { router, admin, isbeGov, other } = await loadFixture(deployFixture);
      await router.connect(isbeGov).pause();
      await expect(
        router.connect(admin).grantRole(ALLOWLIST_ADMIN_ROLE, other.address)
      ).to.emit(router, "RoleGranted");
    });
  });
});
