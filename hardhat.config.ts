import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import '@rumblefishdev/hardhat-kms-signer'
import * as dotenv from "dotenv";

dotenv.config();

const KMS_KEY_ID = process.env.KMS_KEY_ID
const kmsConfig = KMS_KEY_ID ? { kmsKeyId: KMS_KEY_ID } : {}

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
      url: process.env.ISBE_URL ?? process.env.LOCALHOST_URL ?? 'http://localhost:8545',
      chainId: process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : 11073,
      accounts: KMS_KEY_ID
          ? 'remote'
          : process.env.ACCOUNT_PRIVATE_KEY
              ? [process.env.ACCOUNT_PRIVATE_KEY]
              : [],
      ...kmsConfig,
    },
  },
};

export default config;
