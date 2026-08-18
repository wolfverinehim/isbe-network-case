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

describe("TreasuryRouterV1", function () {
  async function deployFixture() {
    const [deployer, admin, isbeGov, payer, reserve, commission, other] =
      await ethers.getSigners();

    const Token = await ethers.getContractFactory("AccEURMock", deployer);
    const token = await Token.deploy(
      "Accuro Euro",
      "AccEUR",
      deployer.address,
      ethers.parseUnits("1000000", 6),
      ethers.parseUnits("100000000", 6)
    );

    const Router = await ethers.getContractFactory("TreasuryRouterV1", deployer);
    const router = await Router.deploy(admin.address, isbeGov.address);

    // Setup: fund payer and approve router
    await token.transfer(payer.address, ethers.parseUnits("10000", 6));
    await token
      .connect(payer)
      .approve(await router.getAddress(), ethers.MaxUint256);

    // Allowlist token and recipients
    await router.connect(admin).allowlistToken(await token.getAddress());
    await router.connect(admin).allowlistRecipient(reserve.address);
    await router.connect(admin).allowlistRecipient(commission.address);

    const deadline = (await time.latest()) + 3600;

    const validRequest = {
      groupId: ethers.encodeBytes32String("group-1"),
      payer: payer.address,
      token: await token.getAddress(),
      reserveRecipient: reserve.address,
      commissionRecipient: commission.address,
      principalAmount: ethers.parseUnits("100", 6),
      commissionAmount: ethers.parseUnits("5", 6),
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
      reserve,
      commission,
      other,
      validRequest,
    };
  }

  describe("Despliegue y roles", function () {
    it("asigna DEFAULT_ADMIN_ROLE, ALLOWLIST_ADMIN_ROLE y PAUSER_ROLE al admin", async function () {
      const { router, admin } = await loadFixture(deployFixture);
      expect(await router.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
      expect(await router.hasRole(ALLOWLIST_ADMIN_ROLE, admin.address)).to.be
        .true;
      expect(await router.hasRole(PAUSER_ROLE, admin.address)).to.be.true;
    });

    it("asigna PAUSER_ROLE a la gobernanza de ISBE (requisito Modalidad 2)", async function () {
      const { router, isbeGov } = await loadFixture(deployFixture);
      expect(await router.hasRole(PAUSER_ROLE, isbeGov.address)).to.be.true;
    });

    it("no asigna roles de gestion a la gobernanza de ISBE", async function () {
      const { router, isbeGov } = await loadFixture(deployFixture);
      expect(await router.hasRole(DEFAULT_ADMIN_ROLE, isbeGov.address)).to.be
        .false;
      expect(await router.hasRole(ALLOWLIST_ADMIN_ROLE, isbeGov.address)).to.be
        .false;
    });

    it("revierte con admin = address(0)", async function () {
      const { isbeGov } = await loadFixture(deployFixture);
      const Router = await ethers.getContractFactory("TreasuryRouterV1");
      await expect(
        Router.deploy(ethers.ZeroAddress, isbeGov.address)
      ).to.be.revertedWith("Invalid admin");
    });

    it("revierte con gobernanza ISBE = address(0)", async function () {
      const { admin } = await loadFixture(deployFixture);
      const Router = await ethers.getContractFactory("TreasuryRouterV1");
      await expect(
        Router.deploy(admin.address, ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid ISBE governance");
    });

    it("se despliega sin pausar", async function () {
      const { router } = await loadFixture(deployFixture);
      expect(await router.paused()).to.be.false;
    });
  });

  describe("Pausabilidad (requisito ISBE)", function () {
    it("la gobernanza de ISBE puede pausar y despausar", async function () {
      const { router, isbeGov } = await loadFixture(deployFixture);
      await expect(router.connect(isbeGov).pause())
        .to.emit(router, "Paused")
        .withArgs(isbeGov.address);
      expect(await router.paused()).to.be.true;

      await expect(router.connect(isbeGov).unpause())
        .to.emit(router, "Unpaused")
        .withArgs(isbeGov.address);
      expect(await router.paused()).to.be.false;
    });

    it("una cuenta sin PAUSER_ROLE no puede pausar", async function () {
      const { router, other } = await loadFixture(deployFixture);
      await expect(router.connect(other).pause()).to.be.revertedWith(
        missingRole(other.address, PAUSER_ROLE)
      );
    });

    it("una cuenta sin PAUSER_ROLE no puede despausar", async function () {
      const { router, isbeGov, other } = await loadFixture(deployFixture);
      await router.connect(isbeGov).pause();
      await expect(router.connect(other).unpause()).to.be.revertedWith(
        missingRole(other.address, PAUSER_ROLE)
      );
    });

    it("bloquea routeFunding cuando esta pausado", async function () {
      const { router, isbeGov, payer, validRequest } =
        await loadFixture(deployFixture);
      await router.connect(isbeGov).pause();
      await expect(
        router.connect(payer).routeFunding(validRequest)
      ).to.be.revertedWith("Pausable: paused");
    });

    it("canRoute devuelve false cuando esta pausado", async function () {
      const { router, isbeGov, validRequest } = await loadFixture(deployFixture);
      await router.connect(isbeGov).pause();
      const [ok, reason] = await router.canRoute(validRequest);
      expect(ok).to.be.false;
      expect(reason).to.equal("Routing paused");
    });

    it("permite operar de nuevo tras despausar", async function () {
      const { router, isbeGov, payer, validRequest } =
        await loadFixture(deployFixture);
      await router.connect(isbeGov).pause();
      await router.connect(isbeGov).unpause();
      await expect(router.connect(payer).routeFunding(validRequest)).to.emit(
        router,
        "FundingRouted"
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
        router.connect(other).removeTokenFromAllowlist(await token.getAddress())
      ).to.be.revertedWith(err);
      await expect(
        router.connect(other).allowlistRecipient(other.address)
      ).to.be.revertedWith(err);
      await expect(
        router.connect(other).removeRecipientFromAllowlist(other.address)
      ).to.be.revertedWith(err);
    });

    it("el admin puede conceder y revocar roles (rotacion)", async function () {
      const { router, admin, other } = await loadFixture(deployFixture);
      await router.connect(admin).grantRole(PAUSER_ROLE, other.address);
      expect(await router.hasRole(PAUSER_ROLE, other.address)).to.be.true;
      await router.connect(admin).revokeRole(PAUSER_ROLE, other.address);
      expect(await router.hasRole(PAUSER_ROLE, other.address)).to.be.false;
    });

    it("emite eventos de allowlist", async function () {
      const { router, admin, other } = await loadFixture(deployFixture);
      await expect(router.connect(admin).allowlistRecipient(other.address))
        .to.emit(router, "RecipientAllowlisted")
        .withArgs(other.address);
      await expect(
        router.connect(admin).removeRecipientFromAllowlist(other.address)
      )
        .to.emit(router, "RecipientRemovedFromAllowlist")
        .withArgs(other.address);
    });

    it("rechaza allowlist de address(0)", async function () {
      const { router, admin } = await loadFixture(deployFixture);
      await expect(
        router.connect(admin).allowlistToken(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid token");
      await expect(
        router.connect(admin).allowlistRecipient(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid recipient");
    });
  });

  describe("routeFunding — happy path", function () {
    it("transfiere principal y comision atomicamente y emite FundingRouted", async function () {
      const { router, token, payer, reserve, commission, validRequest } =
        await loadFixture(deployFixture);

      const tx = router.connect(payer).routeFunding(validRequest);

      await expect(tx).to.changeTokenBalances(
        token,
        [payer, reserve, commission],
        [
          -(validRequest.principalAmount + validRequest.commissionAmount),
          validRequest.principalAmount,
          validRequest.commissionAmount,
        ]
      );
      await expect(tx).to.emit(router, "FundingRouted");
    });

    it("marca el groupId como consumido e incrementa el nonce", async function () {
      const { router, payer, validRequest } = await loadFixture(deployFixture);
      await router.connect(payer).routeFunding(validRequest);
      expect(await router.consumedGroups(validRequest.groupId)).to.be.true;
      expect(await router.payerNonces(payer.address)).to.equal(1n);
    });

    it("permite una segunda operacion con nuevo groupId y nonce", async function () {
      const { router, payer, validRequest } = await loadFixture(deployFixture);
      await router.connect(payer).routeFunding(validRequest);
      const second = {
        ...validRequest,
        groupId: ethers.encodeBytes32String("group-2"),
        nonce: 1n,
      };
      await expect(router.connect(payer).routeFunding(second)).to.emit(
        router,
        "FundingRouted"
      );
    });
  });

  describe("routeFunding — validaciones", function () {
    it("revierte si el caller no es el payer", async function () {
      const { router, other, validRequest } = await loadFixture(deployFixture);
      await expect(
        router.connect(other).routeFunding(validRequest)
      ).to.be.revertedWith("Caller must be payer");
    });

    it("revierte si la request ha expirado", async function () {
      const { router, payer, validRequest } = await loadFixture(deployFixture);
      await time.increaseTo(validRequest.deadline + 1);
      await expect(
        router.connect(payer).routeFunding(validRequest)
      ).to.be.revertedWith("Request expired");
    });

    it("revierte ante replay del mismo groupId", async function () {
      const { router, payer, validRequest } = await loadFixture(deployFixture);
      await router.connect(payer).routeFunding(validRequest);
      const replay = { ...validRequest, nonce: 1n };
      await expect(
        router.connect(payer).routeFunding(replay)
      ).to.be.revertedWith("Group already processed (replay)");
    });

    it("revierte con nonce invalido", async function () {
      const { router, payer, validRequest } = await loadFixture(deployFixture);
      const bad = { ...validRequest, nonce: 5n };
      await expect(router.connect(payer).routeFunding(bad)).to.be.revertedWith(
        "Invalid nonce"
      );
    });

    it("revierte con token no allowlisted", async function () {
      const { router, admin, payer, token, validRequest } =
        await loadFixture(deployFixture);
      await router
        .connect(admin)
        .removeTokenFromAllowlist(await token.getAddress());
      await expect(
        router.connect(payer).routeFunding(validRequest)
      ).to.be.revertedWith("Token not allowlisted");
    });

    it("revierte con reserveRecipient no allowlisted", async function () {
      const { router, admin, payer, reserve, validRequest } =
        await loadFixture(deployFixture);
      await router.connect(admin).removeRecipientFromAllowlist(reserve.address);
      await expect(
        router.connect(payer).routeFunding(validRequest)
      ).to.be.revertedWith("Reserve recipient not allowlisted");
    });

    it("revierte con commissionRecipient no allowlisted", async function () {
      const { router, admin, payer, commission, validRequest } =
        await loadFixture(deployFixture);
      await router
        .connect(admin)
        .removeRecipientFromAllowlist(commission.address);
      await expect(
        router.connect(payer).routeFunding(validRequest)
      ).to.be.revertedWith("Commission recipient not allowlisted");
    });

    it("revierte con importes a cero", async function () {
      const { router, payer, validRequest } = await loadFixture(deployFixture);
      await expect(
        router
          .connect(payer)
          .routeFunding({ ...validRequest, principalAmount: 0n })
      ).to.be.revertedWith("Principal must be > 0");
      await expect(
        router
          .connect(payer)
          .routeFunding({ ...validRequest, commissionAmount: 0n })
      ).to.be.revertedWith("Commission must be > 0");
    });

    it("revierte si reserve y commission son el mismo recipient", async function () {
      const { router, payer, reserve, validRequest } =
        await loadFixture(deployFixture);
      const bad = { ...validRequest, commissionRecipient: reserve.address };
      await expect(router.connect(payer).routeFunding(bad)).to.be.revertedWith(
        "Reserve and commission recipients must differ"
      );
    });
  });

  describe("Atomicidad (all or nothing)", function () {
    it("revierte todo si no hay allowance suficiente para la comision", async function () {
      const { router, token, payer, reserve, validRequest } =
        await loadFixture(deployFixture);
      // Allowance justa solo para el principal
      await token
        .connect(payer)
        .approve(await router.getAddress(), validRequest.principalAmount);

      const reserveBefore = await token.balanceOf(reserve.address);
      await expect(router.connect(payer).routeFunding(validRequest)).to.be
        .reverted;
      // Nada se ha movido
      expect(await token.balanceOf(reserve.address)).to.equal(reserveBefore);
      expect(await router.consumedGroups(validRequest.groupId)).to.be.false;
      expect(await router.payerNonces(payer.address)).to.equal(0n);
    });

    it("revierte todo si el balance no cubre principal + comision", async function () {
      const { router, token, payer, validRequest } =
        await loadFixture(deployFixture);
      const req = {
        ...validRequest,
        principalAmount: ethers.parseUnits("9999", 6),
        commissionAmount: ethers.parseUnits("2", 6), // total > 10000 balance
      };
      await expect(router.connect(payer).routeFunding(req)).to.be.reverted;
      expect(await router.payerNonces(payer.address)).to.equal(0n);
    });
  });

  describe("canRoute", function () {
    it("devuelve true para una request valida", async function () {
      const { router, validRequest } = await loadFixture(deployFixture);
      const [ok, reason] = await router.canRoute(validRequest);
      expect(ok).to.be.true;
      expect(reason).to.equal("Can route");
    });

    it("refleja las mismas validaciones que routeFunding", async function () {
      const { router, payer, validRequest } = await loadFixture(deployFixture);
      let [ok, reason] = await router.canRoute({ ...validRequest, nonce: 3n });
      expect(ok).to.be.false;
      expect(reason).to.equal("Invalid nonce");

      await router.connect(payer).routeFunding(validRequest);
      [ok, reason] = await router.canRoute({ ...validRequest, nonce: 1n });
      expect(ok).to.be.false;
      expect(reason).to.equal("Group already processed");
    });
  });
});
