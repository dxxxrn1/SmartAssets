const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("\n🚀 Deploying SmartAssetCertificate ERC-721 contract...");
  console.log("   Deployer address:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("   Account balance:", hre.ethers.formatEther(balance), "ETH");

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

