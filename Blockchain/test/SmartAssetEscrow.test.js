const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SmartAssetEscrow Contract", function () {
  let Escrow, escrow;
  let owner, buyer, seller, thirdParty, relayer;
  const orderId = 1001;
  const assetTokenId = 42;
  const depositAmount = ethers.parseEther("1.0");
  const trackingHash = ethers.keccak256(ethers.toUtf8Bytes("BRINKS-TRK-987654"));
  const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("DISPUTE-ITEM-DEFECT"));

  beforeEach(async function () {
    [owner, buyer, seller, thirdParty, relayer] = await ethers.getSigners();

    Escrow = await ethers.getContractFactory("SmartAssetEscrow");
    escrow = await Escrow.deploy(owner.address);
    await escrow.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set the right owner", async function () {
      expect(await escrow.owner()).to.equal(owner.address);
    });

    it("should reject plain direct ETH sends without calldata", async function () {
      await expect(
        buyer.sendTransaction({
          to: await escrow.getAddress(),
          value: ethers.parseEther("0.1"),
        })
      ).to.be.revertedWith("Direct transfers not allowed. Call deposit(orderId, seller, tokenId)");
    });
  });

  describe("Deposit / Lock Funds", function () {
    it("should allow buyer to lock payment in escrow directly", async function () {
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

    it("should allow owner/relayer to deposit on behalf of buyer and record customer as buyer", async function () {
      const tx = await escrow.connect(owner).depositOnBehalf(
        orderId,
        buyer.address,
        seller.address,
        assetTokenId,
        { value: depositAmount }
      );

      await expect(tx)
        .to.emit(escrow, "PaymentLocked")
        .withArgs(orderId, buyer.address, seller.address, depositAmount, assetTokenId);

      const order = await escrow.getOrder(orderId);
      expect(order.buyer).to.equal(buyer.address);
      expect(order.seller).to.equal(seller.address);
      expect(order.status).to.equal(1);
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

    it("should revert if buyer and seller are the same", async function () {
      await expect(
        escrow.connect(buyer).deposit(orderId, buyer.address, assetTokenId, {
          value: depositAmount,
        })
      ).to.be.revertedWith("Buyer and seller must be distinct");
    });

    it("should revert if order already exists (replay / collision protection)", async function () {
      await escrow.connect(buyer).deposit(orderId, seller.address, assetTokenId, {
        value: depositAmount,
      });

      await expect(
        escrow.connect(buyer).deposit(orderId, seller.address, assetTokenId, {
          value: depositAmount,
        })
      ).to.be.revertedWith("Order already exists");
    });

    it("should revert if non-owner tries depositOnBehalf", async function () {
      await expect(
        escrow.connect(thirdParty).depositOnBehalf(
          orderId,
          buyer.address,
          seller.address,
          assetTokenId,
          { value: depositAmount }
        )
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });
  });

  describe("Lifecycle & Premature Release Protection", function () {
    beforeEach(async function () {
      await escrow.connect(buyer).deposit(orderId, seller.address, assetTokenId, {
        value: depositAmount,
      });
    });

    it("PREMATURE RELEASE: should REVERT if release is attempted while PaymentLocked", async function () {
      await expect(
        escrow.connect(buyer).releaseToSeller(orderId)
      ).to.be.revertedWith("Order cannot be released in current state: buyer acceptance required");
    });

    it("should allow seller or owner to record shipment", async function () {
      const tx = await escrow.connect(seller).recordShipment(orderId, trackingHash);

      await expect(tx)
        .to.emit(escrow, "AssetDispatched")
        .withArgs(orderId, seller.address, trackingHash, (await ethers.provider.getBlock("latest")).timestamp);

      const order = await escrow.getOrder(orderId);
      expect(order.status).to.equal(2); // InTransit
      expect(order.trackingHash).to.equal(trackingHash);
    });

    it("PREMATURE RELEASE: should REVERT if release is attempted while InTransit", async function () {
      await escrow.connect(seller).recordShipment(orderId, trackingHash);
      await expect(
        escrow.connect(buyer).releaseToSeller(orderId)
      ).to.be.revertedWith("Order cannot be released in current state: buyer acceptance required");
    });

    it("should allow owner to confirm inspection", async function () {
      await escrow.connect(seller).recordShipment(orderId, trackingHash);
      const tx = await escrow.connect(owner).confirmInspection(orderId);

      await expect(tx)
        .to.emit(escrow, "InspectionConfirmed")
        .withArgs(orderId, owner.address, (await ethers.provider.getBlock("latest")).timestamp);

      const order = await escrow.getOrder(orderId);
      expect(order.status).to.equal(3); // InInspection
    });

    it("should allow delivery confirmation and then buyer acceptance", async function () {
      await escrow.connect(seller).recordShipment(orderId, trackingHash);
      await escrow.connect(owner).confirmInspection(orderId);

      // Confirm delivery
      await escrow.connect(buyer).confirmDelivery(orderId);
      let order = await escrow.getOrder(orderId);
      expect(order.status).to.equal(4); // Delivered

      // Buyer accepts
      const acceptTx = await escrow.connect(buyer).acceptAsset(orderId);
      await expect(acceptTx)
        .to.emit(escrow, "BuyerAccepted")
        .withArgs(orderId, buyer.address, (await ethers.provider.getBlock("latest")).timestamp);

      order = await escrow.getOrder(orderId);
      expect(order.status).to.equal(5); // Accepted
    });

    it("should release funds to seller ONLY after buyer acceptance", async function () {
      await escrow.connect(seller).recordShipment(orderId, trackingHash);
      await escrow.connect(owner).confirmInspection(orderId);
      await escrow.connect(buyer).confirmDelivery(orderId);
      await escrow.connect(buyer).acceptAsset(orderId);

      const sellerInitialBal = await ethers.provider.getBalance(seller.address);

      const tx = await escrow.connect(buyer).releaseToSeller(orderId);

      await expect(tx)
        .to.emit(escrow, "FundsReleased")
        .withArgs(orderId, seller.address, depositAmount, (await ethers.provider.getBlock("latest")).timestamp);

      const sellerFinalBal = await ethers.provider.getBalance(seller.address);
      expect(sellerFinalBal - sellerInitialBal).to.equal(depositAmount);

      const order = await escrow.getOrder(orderId);
      expect(order.status).to.equal(7); // ReleasedToSeller
    });

    it("should revert if unauthorized party attempts to release funds", async function () {
      await escrow.connect(seller).recordShipment(orderId, trackingHash);
      await escrow.connect(buyer).confirmDelivery(orderId);
      await escrow.connect(buyer).acceptAsset(orderId);

      await expect(
        escrow.connect(thirdParty).releaseToSeller(orderId)
      ).to.be.revertedWith("Only buyer or platform authority can release funds");
    });
  });

  describe("Dispute & Refund Flow", function () {
    beforeEach(async function () {
      // Relayer deposits on behalf of buyer
      await escrow.connect(owner).depositOnBehalf(
        orderId,
        buyer.address,
        seller.address,
        assetTokenId,
        { value: depositAmount }
      );
    });

    it("should allow buyer to open a dispute with evidence hash", async function () {
      await escrow.connect(seller).recordShipment(orderId, trackingHash);

      const tx = await escrow.connect(buyer).openDispute(orderId, evidenceHash);

      await expect(tx)
        .to.emit(escrow, "DisputeOpened")
        .withArgs(orderId, buyer.address, evidenceHash, (await ethers.provider.getBlock("latest")).timestamp);

      const order = await escrow.getOrder(orderId);
      expect(order.status).to.equal(6); // Disputed
    });

    it("should freeze release while Disputed", async function () {
      await escrow.connect(buyer).openDispute(orderId, evidenceHash);

      await expect(
        escrow.connect(buyer).releaseToSeller(orderId)
      ).to.be.revertedWith("Order cannot be released in current state: buyer acceptance required");
    });

    it("should refund directly to the actual customer buyer address, NOT the relayer/owner", async function () {
      await escrow.connect(buyer).openDispute(orderId, evidenceHash);

      const buyerInitialBal = await ethers.provider.getBalance(buyer.address);

      const tx = await escrow.connect(owner).refundToBuyer(orderId);

      await expect(tx)
        .to.emit(escrow, "BuyerRefunded")
        .withArgs(orderId, buyer.address, depositAmount, (await ethers.provider.getBlock("latest")).timestamp);

      const buyerFinalBal = await ethers.provider.getBalance(buyer.address);
      expect(buyerFinalBal - buyerInitialBal).to.equal(depositAmount);

      const order = await escrow.getOrder(orderId);
      expect(order.status).to.equal(8); // RefundedToBuyer
    });

    it("should allow seller to voluntarily refund buyer", async function () {
      const buyerInitialBal = await ethers.provider.getBalance(buyer.address);

      await escrow.connect(seller).refundToBuyer(orderId);

      const buyerFinalBal = await ethers.provider.getBalance(buyer.address);
      expect(buyerFinalBal - buyerInitialBal).to.equal(depositAmount);

      const order = await escrow.getOrder(orderId);
      expect(order.status).to.equal(8); // RefundedToBuyer
    });

    it("should revert if unauthorized party attempts refund", async function () {
      await expect(
        escrow.connect(thirdParty).refundToBuyer(orderId)
      ).to.be.revertedWith("Only seller or platform authority can authorize refund");
    });

    it("should revert if refund is attempted on already released or refunded order", async function () {
      await escrow.connect(seller).refundToBuyer(orderId);

      await expect(
        escrow.connect(owner).refundToBuyer(orderId)
      ).to.be.revertedWith("Order cannot be refunded in current state");
    });
  });
});
