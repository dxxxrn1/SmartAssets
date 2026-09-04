const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("\n🚀 Deploying SmartAssetEscrow smart contract...");
  console.log("   Deployer address:", deployer.address);

  const SmartAssetEscrow = await hre.ethers.getContractFactory("SmartAssetEscrow");
  const contract = await SmartAssetEscrow.deploy(deployer.address);

  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  console.log("✅ SmartAssetEscrow deployed successfully!");
  console.log("   Contract Address:", contractAddress);

  const network = await hre.ethers.provider.getNetwork();
  console.log("   Network:", network.name, "(Chain ID:", network.chainId.toString() + ")");

  // Export ABI and contract address to Backend
  const artifactsPath = path.resolve(
    __dirname,
    "../artifacts/contracts/SmartAssetEscrow.sol/SmartAssetEscrow.json"
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

  const exportPath = path.join(backendContractsDir, "SmartAssetEscrow.json");
  fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
  console.log("📄 Escrow artifact and ABI exported to:", exportPath, "\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Escrow deployment failed:", error);
    process.exit(1);
  });

