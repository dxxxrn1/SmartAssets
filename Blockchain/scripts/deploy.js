const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const signers = await hre.ethers.getSigners();
  if (!signers || signers.length === 0) {
    console.error("\n❌ Deployment halted: No valid Sepolia deployer private key configured.");
    console.error("   Please set SEPOLIA_RELAYER_PRIVATE_KEY in your .env file.");
    console.error("   The key must be a 64-character hexadecimal private key (32 bytes), e.g. from MetaMask account export.");
    console.error("   Example: SEPOLIA_RELAYER_PRIVATE_KEY=\"0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\"\n");
    process.exit(1);
  }
  const deployer = signers[0];
  console.log("\n🚀 Deploying SmartAssetCertificate ERC-721 contract...");
  console.log("   Deployer address:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("   Account balance:", hre.ethers.formatEther(balance), "ETH");

  const minRequired = hre.ethers.parseEther("0.015");
  if (balance < minRequired) {
    console.error(`\n❌ Insufficient Sepolia test ETH for deployment:`);
    console.error(`   Current Balance: ${hre.ethers.formatEther(balance)} ETH`);
    console.error(`   Estimated Gas Required: ~0.015 to 0.05 ETH`);
    console.error(`\n   To get free Sepolia test ETH for deployer ${deployer.address}:`);
    console.error(`   1. Google Cloud Web3 Faucet: https://cloud.google.com/application/web3/faucet/ethereum/sepolia`);
    console.error(`   2. Sepolia PoW Faucet (Instant): https://sepolia-faucet.pk910.de/`);
    console.error(`   3. Alchemy Faucet: https://www.alchemy.com/faucets/ethereum-sepolia\n`);
    process.exit(1);
  }

  const SmartAssetCertificate = await hre.ethers.getContractFactory("SmartAssetCertificate");
  const contract = await SmartAssetCertificate.deploy(deployer.address);

  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  console.log("✅ SmartAssetCertificate deployed successfully!");
  console.log("   Contract Address:", contractAddress);

  const network = await hre.ethers.provider.getNetwork();
  console.log("   Network:", network.name, "(Chain ID:", network.chainId.toString() + ")");

  if (network.chainId === 11155111n) {
    console.log(`   Etherscan Explorer: https://sepolia.etherscan.io/address/${contractAddress}\n`);
  }

  // Export ABI and contract address to Backend
  const artifactsPath = path.resolve(
    __dirname,
    "../artifacts/contracts/SmartAssetCertificate.sol/SmartAssetCertificate.json"
  );
  const contractArtifact = JSON.parse(fs.readFileSync(artifactsPath, "utf8"));

  const backendContractsDir = path.resolve(__dirname, "../../Backend/src/contracts");
  if (!fs.existsSync(backendContractsDir)) {
    fs.mkdirSync(backendContractsDir, { recursive: true });
  }

  const exportData = {
    contractAddress,
    networkName: network.name === "unknown" ? "sepolia" : network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    abi: contractArtifact.abi,
    bytecode: contractArtifact.bytecode,
  };

  const exportPath = path.join(backendContractsDir, "SmartAssetCertificate.json");
  fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
  console.log("📄 Contract artifact and ABI exported to:", exportPath, "\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });

