// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SmartAssetEscrow
 * @dev High-value luxury collectible escrow smart contract.
 * Holds buyer funds in trust on Ethereum Sepolia with verified sequential lifecycle:
 * PaymentLocked -> InTransit -> InInspection / Delivered -> Accepted -> ReleasedToSeller
 * With explicit dispute and refund capabilities for authorized parties.
 */
contract SmartAssetEscrow is Ownable, ReentrancyGuard {
    enum EscrowStatus {
        None,
        PaymentLocked,
        InTransit,
        InInspection,
        Delivered,
        Accepted,
        Disputed,
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
        bytes32 trackingHash;
        bytes32 disputeEvidence;
        uint256 createdAt;
        uint256 shippedAt;
        uint256 deliveredAt;
        uint256 acceptedAt;
        uint256 disputedAt;
        uint256 resolvedAt;
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

    event AssetDispatched(
        uint256 indexed orderId,
        address indexed seller,
        bytes32 trackingHash,
        uint256 timestamp
    );

    event InspectionConfirmed(
        uint256 indexed orderId,
        address indexed inspector,
        uint256 timestamp
    );

    event DeliveryConfirmed(
        uint256 indexed orderId,
        address indexed confirmedBy,
        uint256 timestamp
    );

    event BuyerAccepted(
        uint256 indexed orderId,
        address indexed buyer,
        uint256 timestamp
    );

    event DisputeOpened(
        uint256 indexed orderId,
        address indexed openedBy,
        bytes32 evidenceHash,
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
     * @notice Locks buyer payment into escrow directly by caller (buyer).
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
        require(seller != msg.sender, "Buyer and seller must be distinct");
        require(orders[orderId].status == EscrowStatus.None, "Order already exists");

        orders[orderId] = EscrowOrder({
            orderId: orderId,
            buyer: payable(msg.sender),
            seller: seller,
            amount: msg.value,
            assetTokenId: assetTokenId,
            status: EscrowStatus.PaymentLocked,
            trackingHash: bytes32(0),
            disputeEvidence: bytes32(0),
            createdAt: block.timestamp,
            shippedAt: 0,
            deliveredAt: 0,
            acceptedAt: 0,
            disputedAt: 0,
            resolvedAt: 0
        });

        emit PaymentLocked(orderId, msg.sender, seller, msg.value, assetTokenId);
    }

    /**
     * @notice Locks payment on behalf of an authenticated buyer (via relayer or card/bank settlement).
     * Preserves buyer's real wallet address so refunds return to the actual buyer, not the relayer.
     * @param orderId Unique order identifier.
     * @param buyer Address of the customer buyer.
     * @param seller Address of the merchant seller.
     * @param assetTokenId Token ID of the NFT certificate representing the asset.
     */
    function depositOnBehalf(
        uint256 orderId,
        address payable buyer,
        address payable seller,
        uint256 assetTokenId
    ) external payable onlyOwner nonReentrant {
        require(msg.value > 0, "Deposit amount must be greater than 0");
        require(buyer != address(0), "Invalid buyer address");
        require(seller != address(0), "Invalid seller address");
        require(buyer != seller, "Buyer and seller must be distinct");
        require(orders[orderId].status == EscrowStatus.None, "Order already exists");

        orders[orderId] = EscrowOrder({
            orderId: orderId,
            buyer: buyer,
            seller: seller,
            amount: msg.value,
            assetTokenId: assetTokenId,
            status: EscrowStatus.PaymentLocked,
            trackingHash: bytes32(0),
            disputeEvidence: bytes32(0),
            createdAt: block.timestamp,
            shippedAt: 0,
            deliveredAt: 0,
            acceptedAt: 0,
            disputedAt: 0,
            resolvedAt: 0
        });

        emit PaymentLocked(orderId, buyer, seller, msg.value, assetTokenId);
    }

    /**
     * @notice Seller records shipment details (courier, tracking hash).
     */
    function recordShipment(uint256 orderId, bytes32 trackingHash) external {
        EscrowOrder storage order = orders[orderId];
        require(order.status == EscrowStatus.PaymentLocked, "Order not in valid state for shipment");
        require(
            msg.sender == order.seller || msg.sender == owner(),
            "Only seller or platform authority can record shipment"
        );

        order.status = EscrowStatus.InTransit;
        order.trackingHash = trackingHash;
        order.shippedAt = block.timestamp;

        emit AssetDispatched(orderId, msg.sender, trackingHash, block.timestamp);
    }

    /**
     * @notice Marks the asset physical condition and authenticity verified by certified appraiser.
     */
    function confirmInspection(uint256 orderId) external onlyOwner {
        EscrowOrder storage order = orders[orderId];
        require(
            order.status == EscrowStatus.PaymentLocked || order.status == EscrowStatus.InTransit,
            "Order not in valid state for inspection"
        );

        order.status = EscrowStatus.InInspection;
        emit InspectionConfirmed(orderId, msg.sender, block.timestamp);
    }

    /**
     * @notice Buyer alone confirms physical receipt of the collectible.
     */
    function confirmDelivery(uint256 orderId) external {
        EscrowOrder storage order = orders[orderId];
        require(
            order.status == EscrowStatus.InTransit || order.status == EscrowStatus.InInspection,
            "Order not in valid state for delivery confirmation"
        );
        require(msg.sender == order.buyer, "Only buyer can confirm delivery");

        order.status = EscrowStatus.Delivered;
        order.deliveredAt = block.timestamp;

        emit DeliveryConfirmed(orderId, msg.sender, block.timestamp);
    }

    /**
     * @notice Buyer verifies and accepts the physical collectible.
     */
    function acceptAsset(uint256 orderId) external {
        EscrowOrder storage order = orders[orderId];
        require(
            order.status == EscrowStatus.Delivered,
            "Order must be delivered before acceptance"
        );
        require(msg.sender == order.buyer, "Only buyer can accept asset");

        order.status = EscrowStatus.Accepted;
        order.acceptedAt = block.timestamp;

        emit BuyerAccepted(orderId, msg.sender, block.timestamp);
    }

    /**
     * @notice Releases locked funds to the seller once asset is delivered and accepted.
     * Prevents premature release while order is pending shipment or in transit.
     */
    function releaseToSeller(uint256 orderId) external nonReentrant {
        EscrowOrder storage order = orders[orderId];
        require(
            order.status == EscrowStatus.Accepted,
            "Order cannot be released in current state: buyer acceptance required"
        );
        require(
            msg.sender == owner(),
            "Only platform administrator can release funds"
        );

        uint256 amountToTransfer = order.amount;
        order.status = EscrowStatus.ReleasedToSeller;
        order.resolvedAt = block.timestamp;

        (bool success, ) = order.seller.call{value: amountToTransfer}("");
        require(success, "Transfer to seller failed");

        emit FundsReleased(orderId, order.seller, amountToTransfer, block.timestamp);
    }

    /**
     * @notice Opens a dispute with audit evidence hash, freezing release until resolved.
     */
    function openDispute(uint256 orderId, bytes32 evidenceHash) external {
        EscrowOrder storage order = orders[orderId];
        require(
            order.status == EscrowStatus.PaymentLocked ||
            order.status == EscrowStatus.InTransit ||
            order.status == EscrowStatus.InInspection ||
            order.status == EscrowStatus.Delivered,
            "Cannot dispute in current order status"
        );
        require(
            msg.sender == order.buyer || msg.sender == order.seller,
            "Only buyer or seller can open dispute"
        );

        order.status = EscrowStatus.Disputed;
        order.disputeEvidence = evidenceHash;
        order.disputedAt = block.timestamp;

        emit DisputeOpened(orderId, msg.sender, evidenceHash, block.timestamp);
    }

    /**
     * @notice Refunds locked payment back to the actual buyer.
     * Only the platform owner/administrator may authorize this transfer.
     */
    function refundToBuyer(uint256 orderId) external nonReentrant {
        EscrowOrder storage order = orders[orderId];
        require(
            order.status != EscrowStatus.None &&
            order.status != EscrowStatus.ReleasedToSeller &&
            order.status != EscrowStatus.RefundedToBuyer,
            "Order cannot be refunded in current state"
        );
        require(msg.sender == owner(), "Only platform administrator can authorize refund");

        uint256 amountToRefund = order.amount;
        order.status = EscrowStatus.RefundedToBuyer;
        order.resolvedAt = block.timestamp;

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

    /**
     * @dev Reject plain ETH sends without deposit calldata with an informative error.
     */
    receive() external payable {
        revert("Direct transfers not allowed. Call deposit(orderId, seller, tokenId)");
    }
}
