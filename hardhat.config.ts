import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { defineConfig } from "hardhat/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function stripOptionalQuotes(value: string) {
  if (value.length >= 2 && value[0] === value[value.length - 1] && ['"', "'"].includes(value[0])) {
    return value.slice(1, -1);
  }

  return value;
}

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const [key, ...rest] = line.split("=");
    const normalizedKey = key.trim();
    if (!normalizedKey || process.env[normalizedKey] !== undefined) {
      continue;
    }

    process.env[normalizedKey] = stripOptionalQuotes(rest.join("=").trim());
  }
}

function normalizePrivateKey(value: string | undefined) {
  const normalizedValue = value?.trim();
  if (!normalizedValue) {
    return undefined;
  }

  return normalizedValue.startsWith("0x") ? normalizedValue : `0x${normalizedValue}`;
}

loadEnvFile(path.join(__dirname, ".env"));

const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL?.trim();
const sepoliaPrivateKey = normalizePrivateKey(process.env.SEPOLIA_PRIVATE_KEY);

const networks = {
  hardhatMainnet: {
    type: "edr-simulated" as const,
    chainType: "l1" as const,
  },
  hardhatOp: {
    type: "edr-simulated" as const,
    chainType: "op" as const,
  },
  ...(sepoliaRpcUrl && sepoliaPrivateKey
    ? {
        sepolia: {
          type: "http" as const,
          chainType: "l1" as const,
          url: sepoliaRpcUrl,
          accounts: [sepoliaPrivateKey],
        },
      }
    : {}),
};

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks,
});
