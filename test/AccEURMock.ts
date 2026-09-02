import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));

const missingRole = (account: string, role: string) =>
  `AccessControl: account ${account.toLowerCase()} is missing role ${role}`;

describe("AccEURMock", function () {
  const INITIAL_SUPPLY = ethers.parseUnits("1000000", 6);
  const MAX_SUPPLY = ethers.parseUnits("100000000", 6);

  async function deployFixture() {
    const [admin, isbeGov, holder, other] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("AccEURMock", admin);
    const token = await Token.deploy(
      "Accuro Euro",
      "AccEUR",
      admin.address,
      isbeGov.address,
      INITIAL_SUPPLY,
      MAX_SUPPLY
    );
    return { token, admin, isbeGov, holder, other };
  }

  describe("Despliegue y roles", function () {
    it("asigna los roles al admin y PAUSER_ROLE a la gobernanza ISBE", async function () {
      const { token, admin, isbeGov } = await loadFixture(deployFixture);
      expect(await token.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
      expect(await token.hasRole(MINTER_ROLE, admin.address)).to.be.true;
      expect(await token.hasRole(PAUSER_ROLE, admin.address)).to.be.true;
      expect(await token.hasRole(PAUSER_ROLE, isbeGov.address)).to.be.true;
    });

    it("no concede roles de gestion a la gobernanza ISBE", async function () {
      const { token, isbeGov } = await loadFixture(deployFixture);
      expect(await token.hasRole(DEFAULT_ADMIN_ROLE, isbeGov.address)).to.be.false;
      expect(await token.hasRole(MINTER_ROLE, isbeGov.address)).to.be.false;
    });

    it("inicializa metadatos, supply y cap", async function () {
      const { token, admin } = await loadFixture(deployFixture);
      expect(await token.name()).to.equal("Accuro Euro");
      expect(await token.symbol()).to.equal("AccEUR");
      expect(await token.decimals()).to.equal(6);
      expect(await token.totalSupply()).to.equal(INITIAL_SUPPLY);
      expect(await token.maxSupply()).to.equal(MAX_SUPPLY);
      expect(await token.balanceOf(admin.address)).to.equal(INITIAL_SUPPLY);
      expect(await token.paused()).to.be.false;
    });

    it("revierte con parametros de constructor invalidos", async function () {
      const [admin, isbeGov] = await ethers.getSigners();
      const Token = await ethers.getContractFactory("AccEURMock");
      await expect(
        Token.deploy("A", "A", ethers.ZeroAddress, isbeGov.address, 0, MAX_SUPPLY)
      ).to.be.revertedWith("Invalid admin");
      await expect(
        Token.deploy("A", "A", admin.address, ethers.ZeroAddress, 0, MAX_SUPPLY)
      ).to.be.revertedWith("Invalid ISBE governance");
      await expect(
        Token.deploy("A", "A", admin.address, isbeGov.address, 0, 0)
      ).to.be.revertedWith("Invalid max supply");
      await expect(
        Token.deploy("A", "A", admin.address, isbeGov.address, MAX_SUPPLY + 1n, MAX_SUPPLY)
      ).to.be.revertedWith("Initial supply exceeds max");
    });
  });

  describe("Pausabilidad (requisito ISBE)", function () {
    it("la gobernanza de ISBE puede pausar y despausar", async function () {
      const { token, isbeGov } = await loadFixture(deployFixture);
      await expect(token.connect(isbeGov).pause()).to.emit(token, "Paused");
      expect(await token.paused()).to.be.true;
      await expect(token.connect(isbeGov).unpause()).to.emit(token, "Unpaused");
      expect(await token.paused()).to.be.false;
    });

    it("una cuenta sin PAUSER_ROLE no puede pausar ni despausar", async function () {
      const { token, isbeGov, other } = await loadFixture(deployFixture);
      await expect(token.connect(other).pause()).to.be.revertedWith(
        missingRole(other.address, PAUSER_ROLE)
      );
      await token.connect(isbeGov).pause();
      await expect(token.connect(other).unpause()).to.be.revertedWith(
        missingRole(other.address, PAUSER_ROLE)
      );
    });

    it("bloquea transferencias, aprobaciones y emision cuando esta pausado", async function () {
      const { token, admin, isbeGov, holder } = await loadFixture(deployFixture);
      await token.connect(isbeGov).pause();

      await expect(token.transfer(holder.address, 1n)).to.be.revertedWith("Pausable: paused");
      await expect(token.approve(holder.address, 1n)).to.be.revertedWith("Pausable: paused");
      await expect(token.increaseAllowance(holder.address, 1n)).to.be.revertedWith("Pausable: paused");
      await expect(token.decreaseAllowance(holder.address, 0n)).to.be.revertedWith("Pausable: paused");
      await expect(token.transferFrom(admin.address, holder.address, 1n)).to.be.revertedWith("Pausable: paused");
      await expect(token.mint(holder.address, 1n)).to.be.revertedWith("Pausable: paused");
      await expect(token.burn(1n)).to.be.revertedWith("Pausable: paused");
    });

    it("bloquea la configuracion critica cuando esta pausado", async function () {
      const { token, isbeGov } = await loadFixture(deployFixture);
      await token.connect(isbeGov).pause();
      await expect(token.disableMinting()).to.be.revertedWith("Pausable: paused");
    });

    it("permite operar de nuevo tras despausar", async function () {
      const { token, isbeGov, holder } = await loadFixture(deployFixture);
      await token.connect(isbeGov).pause();
      await token.connect(isbeGov).unpause();
      await expect(token.transfer(holder.address, 100n)).to.emit(token, "Transfer");
    });

    it("la pausa no bloquea la gestion de roles (remediacion de claves)", async function () {
      const { token, isbeGov, other } = await loadFixture(deployFixture);
      await token.connect(isbeGov).pause();
      await expect(token.grantRole(MINTER_ROLE, other.address)).to.emit(token, "RoleGranted");
      await expect(token.revokeRole(MINTER_ROLE, other.address)).to.emit(token, "RoleRevoked");
    });
  });

  describe("Control de acceso (RBAC)", function () {
    it("solo MINTER_ROLE puede emitir", async function () {
      const { token, other, holder } = await loadFixture(deployFixture);
      await expect(token.connect(other).mint(holder.address, 1n)).to.be.revertedWith(
        missingRole(other.address, MINTER_ROLE)
      );
      await expect(token.mint(holder.address, 1n)).to.emit(token, "Transfer");
    });

    it("solo DEFAULT_ADMIN_ROLE puede deshabilitar la emision", async function () {
      const { token, other } = await loadFixture(deployFixture);
      await expect(token.connect(other).disableMinting()).to.be.revertedWith(
        missingRole(other.address, DEFAULT_ADMIN_ROLE)
      );
    });

    it("permite rotar el MINTER_ROLE", async function () {
      const { token, other, holder } = await loadFixture(deployFixture);
      await token.grantRole(MINTER_ROLE, other.address);
      await expect(token.connect(other).mint(holder.address, 10n)).to.emit(token, "Transfer");
      await token.revokeRole(MINTER_ROLE, other.address);
      await expect(token.connect(other).mint(holder.address, 10n)).to.be.revertedWith(
        missingRole(other.address, MINTER_ROLE)
      );
    });
  });

  describe("Emision y cap", function () {
    it("respeta el cap inmutable", async function () {
      const { token, holder } = await loadFixture(deployFixture);
      await expect(token.mint(holder.address, MAX_SUPPLY)).to.be.revertedWith("Max supply exceeded");
    });

    it("disableMinting es irreversible y bloquea nuevas emisiones", async function () {
      const { token, holder } = await loadFixture(deployFixture);
      await expect(token.disableMinting()).to.emit(token, "MintingDisabled");
      expect(await token.mintingDisabled()).to.be.true;
      await expect(token.disableMinting()).to.be.revertedWith("Minting already disabled");
      await expect(token.mint(holder.address, 1n)).to.be.revertedWith("Minting disabled");
    });

    it("burn reduce balance y totalSupply", async function () {
      const { token, admin } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits("100", 6);
      await token.burn(amount);
      expect(await token.totalSupply()).to.equal(INITIAL_SUPPLY - amount);
      expect(await token.balanceOf(admin.address)).to.equal(INITIAL_SUPPLY - amount);
    });
  });

  describe("Semantica ERC20", function () {
    it("transfiere y valida saldo insuficiente", async function () {
      const { token, holder, other } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits("500", 6);
      await token.transfer(holder.address, amount);
      expect(await token.balanceOf(holder.address)).to.equal(amount);
      await expect(token.connect(other).transfer(holder.address, 1n)).to.be.revertedWith(
        "Insufficient balance"
      );
    });

    it("gestiona allowance en transferFrom", async function () {
      const { token, admin, holder, other } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits("200", 6);
      await token.approve(holder.address, amount);
      expect(await token.allowance(admin.address, holder.address)).to.equal(amount);

      await token.connect(holder).transferFrom(admin.address, other.address, amount);
      expect(await token.balanceOf(other.address)).to.equal(amount);
      expect(await token.allowance(admin.address, holder.address)).to.equal(0n);

      await expect(
        token.connect(holder).transferFrom(admin.address, other.address, 1n)
      ).to.be.revertedWith("Insufficient allowance");
    });

    it("aumenta y reduce allowance con validaciones", async function () {
      const { token, admin, holder } = await loadFixture(deployFixture);
      await token.increaseAllowance(holder.address, 100n);
      expect(await token.allowance(admin.address, holder.address)).to.equal(100n);
      await token.decreaseAllowance(holder.address, 40n);
      expect(await token.allowance(admin.address, holder.address)).to.equal(60n);
      await expect(token.decreaseAllowance(holder.address, 100n)).to.be.revertedWith(
        "Decreased below zero"
      );
    });

    it("rechaza direcciones invalidas", async function () {
      const { token } = await loadFixture(deployFixture);
      await expect(token.transfer(ethers.ZeroAddress, 1n)).to.be.revertedWith("Invalid to");
      await expect(token.approve(ethers.ZeroAddress, 1n)).to.be.revertedWith("Invalid spender");
    });
  });
});
