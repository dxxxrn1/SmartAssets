const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SmartAssetEscrow Contract", function () {
  let Escrow, escrow;
  let owner, buyer, seller, thirdParty;
  const orderId = 1001;
  const assetTokenId = 42;
  const depositAmount = ethers.parseEther("1.0");

  beforeEach(async function () {
    [owner, buyer, seller, thirdParty] = await ethers.getSigners();

    Escrow = await ethers.getContractFactory("SmartAssetEscrow");
    escrow = await Escrow.deploy(owner.address);
    await escrow.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set the right owner", async function () {
      expect(await escrow.owner()).to.equal(owner.address);
    });
  });

  describe("Deposit / Lock Funds", function () {
    it("should allow buyer to lock payment in escrow", async function () {
      const tx = await escrow.connect(buyer).deposit(orderId, seller.address, assetTokenId, {
        value: depositAmount,
      });

      await expect(tx)
        .to.emit(escrow, "PaymentLocked")
        .withArgs(orderId, buyer.address, seller.address, depositAmount, assetTokenId);

      const order = await escrow.getOrder(orderId);
      expect(order.orderId).to.equal(orderId);
      expect(order.buyer).to.equal(buyer.address);
      expect(order.seller).to.equal(seller.address);
      expect(order.amount).to.equal(depositAmount);
      expect(order.assetTokenId).to.equal(assetTokenId);
      expect(order.status).to.equal(1); // EscrowStatus.PaymentLocked
    });

    it("should revert if deposit value is zero", async function () {
      await expect(
        escrow.connect(buyer).deposit(orderId, seller.address, assetTokenId, {
          value: 0,
        })
      ).to.be.revertedWith("Deposit amount must be greater than 0");
    });

    it("should revert if seller address is zero", async function () {
      await expect(
        escrow.connect(buyer).deposit(orderId, ethers.ZeroAddress, assetTokenId, {
          value: depositAmount,
        })
      ).to.be.revertedWith("Invalid seller address");
    });

    it("should revert if order already exists", async function () {
      await escrow.connect(buyer).deposit(orderId, seller.address, assetTokenId, {
        value: depositAmount,
      });

      await expect(
        escrow.connect(buyer).deposit(orderId, seller.address, assetTokenId, {
          value: depositAmount,
        })
      ).to.be.revertedWith("Order already exists");
    });
  });

  describe("Inspection", function () {
    beforeEach(async function () {
      await escrow.connect(buyer).deposit(orderId, seller.address, assetTokenId, {
        value: depositAmount,
      });
    });

    it("should allow owner to confirm inspection", async function () {
      const tx = await escrow.connect(owner).confirmInspection(orderId);

      await expect(tx)
        .to.emit(escrow, "InspectionConfirmed")
        .withArgs(orderId, owner.address, (await ethers.provider.getBlock("latest")).timestamp);

      const order = await escrow.getOrder(orderId);
      expect(order.status).to.equal(2); // EscrowStatus.InInspection
    });

    it("should revert if non-owner tries to confirm inspection", async function () {
      await expect(
        escrow.connect(thirdParty).confirmInspection(orderId)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });
  });

  describe("Release to Seller", function () {
    beforeEach(async function () {
      await escrow.connect(buyer).deposit(orderId, seller.address, assetTokenId, {
        value: depositAmount,
      });
    });

    it("should allow buyer to release funds directly to seller", async function () {
      const sellerInitialBal = await ethers.provider.getBalance(seller.address);

      const tx = await escrow.connect(buyer).releaseToSeller(orderId);

      await expect(tx)
        .to.emit(escrow, "FundsReleased")
        .withArgs(orderId, seller.address, depositAmount, (await ethers.provider.getBlock("latest")).timestamp);

      const sellerFinalBal = await ethers.provider.getBalance(seller.address);
      expect(sellerFinalBal - sellerInitialBal).to.equal(depositAmount);

      const order = await escrow.getOrder(orderId);
      expect(order.status).to.equal(3); // EscrowStatus.ReleasedToSeller
      expect(order.releasedAt).to.be.greaterThan(0);
    });

    it("should allow platform owner to release funds to seller", async function () {
      const sellerInitialBal = await ethers.provider.getBalance(seller.address);

      await escrow.connect(owner).releaseToSeller(orderId);

      const sellerFinalBal = await ethers.provider.getBalance(seller.address);
      expect(sellerFinalBal - sellerInitialBal).to.equal(depositAmount);

      const order = await escrow.getOrder(orderId);
      expect(order.status).to.equal(3); // EscrowStatus.ReleasedToSeller
    });

    it("should revert if unauthorized third party tries to release funds", async function () {
      await expect(
        escrow.connect(thirdParty).releaseToSeller(orderId)
      ).to.be.revertedWith("Only buyer or platform authority can release funds");
    });

    it("should revert if already released", async function () {
      await escrow.connect(buyer).releaseToSeller(orderId);

      await expect(
        escrow.connect(buyer).releaseToSeller(orderId)
      ).to.be.revertedWith("Order cannot be released in current state");
    });
  });

  describe("Refund to Buyer", function () {
    beforeEach(async function () {
      await escrow.connect(buyer).deposit(orderId, seller.address, assetTokenId, {
        value: depositAmount,
      });
    });

    it("should allow owner to refund buyer", async function () {
      const buyerInitialBal = await ethers.provider.getBalance(buyer.address);

      const tx = await escrow.connect(owner).refundToBuyer(orderId);

      await expect(tx)
        .to.emit(escrow, "BuyerRefunded")
        .withArgs(orderId, buyer.address, depositAmount, (await ethers.provider.getBlock("latest")).timestamp);

      const buyerFinalBal = await ethers.provider.getBalance(buyer.address);
      expect(buyerFinalBal - buyerInitialBal).to.equal(depositAmount);

      const order = await escrow.getOrder(orderId);
      expect(order.status).to.equal(4); // EscrowStatus.RefundedToBuyer
    });

    it("should allow seller to authorize refund to buyer", async function () {
      const buyerInitialBal = await ethers.provider.getBalance(buyer.address);

      await escrow.connect(seller).refundToBuyer(orderId);

      const buyerFinalBal = await ethers.provider.getBalance(buyer.address);
      expect(buyerFinalBal - buyerInitialBal).to.equal(depositAmount);

      const order = await escrow.getOrder(orderId);
      expect(order.status).to.equal(4); // EscrowStatus.RefundedToBuyer
    });

    it("should revert if unauthorized third party tries to refund", async function () {
      await expect(
        escrow.connect(thirdParty).refundToBuyer(orderId)
      ).to.be.revertedWith("Only seller or platform authority can authorize refund");
    });

    it("should revert if already refunded", async function () {
      await escrow.connect(owner).refundToBuyer(orderId);

      await expect(
        escrow.connect(owner).refundToBuyer(orderId)
      ).to.be.revertedWith("Order cannot be refunded in current state");
    });
  });
});

