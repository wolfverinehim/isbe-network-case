# ISBE LOCAL NETWORK ENVIRONMENT
**This document explains the basic operations for using the local isbe environment.**

## DESCRIPTION
This environment has been designed to enable the use of ISBE networks locally, allowing developers to manage the environment locally without depending on any remote, multi-user environment.

There are two ISBE networks:
- Networks based on secp256r1 signature
- Networks based on secp256k1 signature

Depending on the distribution that has been downloaded, one or the other will be used.

## REQUIREMENTS

To execute the scripts contained in this directory, you need the following:

- **Docker**: Must be installed and running
  - Verify installation: `docker --version`
  - Verify it's running: `docker info`

- **jq**: JSON processor for parsing configuration files
  - Install on Debian/Ubuntu: `apt-get install jq`
  - Install on macOS: `brew install jq`

The repository intentionally does not publish validator private keys or node
databases. A clean clone needs a private network bundle restored under
`QBFT-Network/` before the network can be started.


## BASIC USAGE
From this directory, after restoring the private `QBFT-Network/` data:

To start:
```bash
bash ./startNetwork.sh
```

This creates the Docker network `besu-network` and starts four Besu nodes.
The bootnode JSON-RPC is available at `http://localhost:8545`; validator RPC
ports are `8546`, `8547` and `8548`. The local chain ID is `11073`.

Verify the network:
```bash
docker ps --filter label=project=besu
curl -s -X POST http://localhost:8545 \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
```


To stop:
```bash
bash ./stopNetwork.sh
```

The scripts are intended for Linux, macOS or WSL. Docker Desktop must be
running before starting the network. Do not commit `.env` files, validator
keys or exported network bundles.

