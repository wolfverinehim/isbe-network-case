import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const { ISBE_RPC_URL, ACCOUNT_PRIVATE_KEY } = process.env;

const config: HardhatUserConfig = {
  // Build reproducible (requisito ISBE): version exacta y flags explicitos
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      metadata: {
        // Facilita la verificacion bytecode <-> codigo fuente
        bytecodeHash: "ipfs",
      },
    },
  },
  networks: {
    isbe: {
      url: ISBE_RPC_URL ?? "",
      chainId: Number(process.env.CHAIN_ID),
      accounts: ACCOUNT_PRIVATE_KEY ? [ACCOUNT_PRIVATE_KEY] : [],
      // Redes Besu/QBFT suelen ser gas-free; ajustar si aplica
    },
  },
};

export default config;
