// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SmartAssetCertificate
 * @dev ERC-721 Token for SmartAssets Collectibles & Certificates of Authenticity.
 * Tracks asset ownership, certificate metadata, and chain-of-custody milestones on-chain.
 */
contract SmartAssetCertificate is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    struct AssetCertificate {
        string certNumber;
        string assetCategory;
        uint256 assetValue;
        uint256 mintedAt;
    }

    struct ProvenanceMilestone {
        uint256 timestamp;
        string eventHash;
        string description;
        string party;
    }

    // Mapping from Token ID => Certificate metadata
    mapping(uint256 => AssetCertificate) public certificates;

    // Mapping from Token ID => Chain-of-custody provenance milestones
    mapping(uint256 => ProvenanceMilestone[]) private _milestones;

    // Events
    event CertificateMinted(
        uint256 indexed tokenId,
        address indexed recipient,
        string certNumber,
        string assetCategory,
        uint256 assetValue
    );

    event ProvenanceRecorded(
        uint256 indexed tokenId,
        string eventHash,
        string party,
        uint256 timestamp
    );

    constructor(address initialOwner)
        ERC721("SmartAssets Certificate", "SMARTCERT")
        Ownable(initialOwner)
    {
        _nextTokenId = 1; // Start token IDs at 1
    }

    /**
     * @notice Mints a new Certificate of Authenticity NFT for a luxury asset.
     * @param recipient Address that will own the certificate NFT (e.g. user's MetaMask).
     * @param tokenURI Metadata URI describing the asset.
     * @param certNumber Unique platform certificate number.
     * @param assetCategory Category of the asset (e.g. "Luxury Watch", "Fine Art").
     * @param assetValue Appraisal / valuation in integer currency units.
     */
    function mintCertificate(
        address recipient,
        string memory tokenURI,
        string memory certNumber,
        string memory assetCategory,
        uint256 assetValue
    ) public onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;

        _safeMint(recipient, tokenId);
        _setTokenURI(tokenId, tokenURI);

        certificates[tokenId] = AssetCertificate({
            certNumber: certNumber,
            assetCategory: assetCategory,
            assetValue: assetValue,
            mintedAt: block.timestamp
        });

        emit CertificateMinted(tokenId, recipient, certNumber, assetCategory, assetValue);

        return tokenId;
    }

    /**
     * @notice Records an authenticated provenance chain-of-custody milestone on-chain.
     * @param tokenId Token ID of the asset certificate.
     * @param eventHash Cryptographic hash or reference to document.
     * @param description Narrative description of the event.
     * @param party Custodian, auction house, or appraiser involved.
     */
    function recordProvenanceMilestone(
        uint256 tokenId,
        string memory eventHash,
        string memory description,
        string memory party
    ) public onlyOwner {
        require(_ownerOf(tokenId) != address(0), "Certificate does not exist");

        _milestones[tokenId].push(
            ProvenanceMilestone({
                timestamp: block.timestamp,
                eventHash: eventHash,
                description: description,
                party: party
            })
        );

        emit ProvenanceRecorded(tokenId, eventHash, party, block.timestamp);
    }

    /**
     * @notice Returns all provenance milestones for a given certificate.
     */
    function getMilestones(uint256 tokenId)
        external
        view
        returns (ProvenanceMilestone[] memory)
    {
        require(_ownerOf(tokenId) != address(0), "Certificate does not exist");
        return _milestones[tokenId];
    }

    /**
     * @notice Returns the certificate metadata for a given token.
     */
    function getCertificate(uint256 tokenId)
        external
        view
        returns (AssetCertificate memory)
    {
        require(_ownerOf(tokenId) != address(0), "Certificate does not exist");
        return certificates[tokenId];
    }

    /**
     * @notice Returns the total count of minted certificates.
     */
    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }
}

