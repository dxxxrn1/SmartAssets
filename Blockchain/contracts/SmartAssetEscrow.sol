// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SmartAssetEscrow
 * @dev Smart Contract Escrow for high-value luxury collectibles.
 * Holds buyer funds in trust on Ethereum Sepolia until the physical asset
 * is inspected, authenticated, and delivered.
 */
contract SmartAssetEscrow is Ownable, ReentrancyGuard {
    enum EscrowStatus {
        None,
        PaymentLocked,
        InInspection,
        ReleasedToSeller,
        RefundedToBuyer
    }

    struct EscrowOrder {
        uint256 orderId;
        address payable buyer;
        address payable seller;
        uint256 amount;
        uint256 assetTokenId;
        EscrowStatus status;
        uint256 createdAt;
        uint256 releasedAt;
    }

    // Mapping from Order ID => Escrow Order
    mapping(uint256 => EscrowOrder) public orders;

    // Events
    event PaymentLocked(
        uint256 indexed orderId,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        uint256 assetTokenId
    );

    event InspectionConfirmed(
        uint256 indexed orderId,
        address inspector,
        uint256 timestamp
    );

    event FundsReleased(
        uint256 indexed orderId,
        address indexed seller,
        uint256 amount,
        uint256 timestamp
    );

    event BuyerRefunded(
        uint256 indexed orderId,
        address indexed buyer,
        uint256 amount,
        uint256 timestamp
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @notice Locks buyer payment into escrow for a specific asset.
     * @param orderId Unique order identifier.
     * @param seller Address of the seller to receive funds upon completion.
     * @param assetTokenId Token ID of the NFT certificate representing the asset.
     */
    function deposit(
        uint256 orderId,
        address payable seller,
        uint256 assetTokenId
    ) external payable nonReentrant {
        require(msg.value > 0, "Deposit amount must be greater than 0");
        require(seller != address(0), "Invalid seller address");
        require(orders[orderId].status == EscrowStatus.None, "Order already exists");

        orders[orderId] = EscrowOrder({
            orderId: orderId,
            buyer: payable(msg.sender),
            seller: seller,
            amount: msg.value,
            assetTokenId: assetTokenId,
            status: EscrowStatus.PaymentLocked,
            createdAt: block.timestamp,
            releasedAt: 0
        });

        emit PaymentLocked(orderId, msg.sender, seller, msg.value, assetTokenId);
    }

    /**
     * @notice Marks the asset physical condition and authenticity verified by certified appraiser.
     */
    function confirmInspection(uint256 orderId) external onlyOwner {
        EscrowOrder storage order = orders[orderId];
        require(order.status == EscrowStatus.PaymentLocked, "Order not in valid state for inspection");

        order.status = EscrowStatus.InInspection;
        emit InspectionConfirmed(orderId, msg.sender, block.timestamp);
    }

    /**
     * @notice Releases locked funds to the seller once asset is received and confirmed.
     * Can be called by the buyer or by the platform owner.
     */
    function releaseToSeller(uint256 orderId) external nonReentrant {
        EscrowOrder storage order = orders[orderId];
        require(
            order.status == EscrowStatus.PaymentLocked || order.status == EscrowStatus.InInspection,
            "Order cannot be released in current state"
        );
        require(
            msg.sender == order.buyer || msg.sender == owner(),
            "Only buyer or platform authority can release funds"
        );

        uint256 amountToTransfer = order.amount;
        order.status = EscrowStatus.ReleasedToSeller;
        order.releasedAt = block.timestamp;

        (bool success, ) = order.seller.call{value: amountToTransfer}("");
        require(success, "Transfer to seller failed");

        emit FundsReleased(orderId, order.seller, amountToTransfer, block.timestamp);
    }

    /**
     * @notice Refunds locked payment back to the buyer if item fails inspection or fails to ship.
     * Can be authorized by platform owner or seller.
     */
    function refundToBuyer(uint256 orderId) external nonReentrant {
        EscrowOrder storage order = orders[orderId];
        require(
            order.status == EscrowStatus.PaymentLocked || order.status == EscrowStatus.InInspection,
            "Order cannot be refunded in current state"
        );
        require(
            msg.sender == order.seller || msg.sender == owner(),
            "Only seller or platform authority can authorize refund"
        );

        uint256 amountToRefund = order.amount;
        order.status = EscrowStatus.RefundedToBuyer;

        (bool success, ) = order.buyer.call{value: amountToRefund}("");
        require(success, "Refund to buyer failed");

        emit BuyerRefunded(orderId, order.buyer, amountToRefund, block.timestamp);
    }

    /**
     * @notice Returns complete details for an escrow order.
     */
    function getOrder(uint256 orderId) external view returns (EscrowOrder memory) {
        return orders[orderId];
    }
}

