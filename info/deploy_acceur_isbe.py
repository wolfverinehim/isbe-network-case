import argparse
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from web3 import Web3

try:
    import solcx
except ImportError as exc:
    raise SystemExit(
        "Falta dependencia py-solc-x. Instala con: pip install py-solc-x"
    ) from exc


SOLC_VERSION = "0.8.20"
SCRIPT_DIR = Path(__file__).resolve().parent
BACK_DIR = SCRIPT_DIR.parent
CONTRACT_PATH = BACK_DIR / "contracts" / "AccEURMock.sol"
ABI_OUTPUT_PATH = BACK_DIR / "contracts" / "abi" / "AccEURMock.json"


def load_env() -> None:
    env_path = BACK_DIR / ".env"
    if env_path.exists():
        load_dotenv(env_path)


def to_checksum(addr: str, label: str) -> str:
    if not addr or not Web3.is_address(addr):
        raise ValueError(f"{label} invalida: {addr}")
    return Web3.to_checksum_address(addr)


def parse_units(value: str, decimals: int = 6) -> int:
    cleaned = value.strip()
    if not cleaned:
        return 0

    if "." in cleaned:
        whole, fraction = cleaned.split(".", 1)
    else:
        whole, fraction = cleaned, ""

    whole = whole or "0"
    if not whole.isdigit() or (fraction and not fraction.isdigit()):
        raise ValueError(f"Cantidad invalida: {value}")

    fraction = (fraction + ("0" * decimals))[:decimals]
    return int(whole) * (10 ** decimals) + int(fraction)


def compile_contract() -> tuple[list, str]:
    source = CONTRACT_PATH.read_text(encoding="utf-8")

    if SOLC_VERSION not in [str(v) for v in solcx.get_installed_solc_versions()]:
        solcx.install_solc(SOLC_VERSION)

    solcx.set_solc_version(SOLC_VERSION)

    compiled = solcx.compile_standard(
        {
            "language": "Solidity",
            "sources": {
                "AccEURMock.sol": {"content": source},
            },
            "settings": {
                "optimizer": {"enabled": True, "runs": 200},
                "outputSelection": {
                    "*": {
                        "*": ["abi", "evm.bytecode.object"],
                    }
                },
            },
        }
    )

    contract_data = compiled["contracts"]["AccEURMock.sol"]["AccEURMock"]
    abi = contract_data["abi"]
    bytecode = contract_data["evm"]["bytecode"]["object"]

    ABI_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    ABI_OUTPUT_PATH.write_text(json.dumps(abi, indent=2), encoding="utf-8")

    return abi, bytecode


def send_allowlist_tx(web3: Web3, contract, owner_addr: str, owner_pk: str, token_addr: str) -> str:
    fn = contract.functions.allowlistToken(token_addr)
    gas_estimate = int(fn.estimate_gas({"from": owner_addr}))
    nonce = web3.eth.get_transaction_count(owner_addr, "pending")
    tx = fn.build_transaction(
        {
            "from": owner_addr,
            "nonce": nonce,
            "gas": int(gas_estimate * 1.2),
            "gasPrice": int(web3.eth.gas_price),
            "chainId": int(web3.eth.chain_id),
        }
    )
    signed = web3.eth.account.sign_transaction(tx, owner_pk)
    tx_hash = web3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = web3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)
    if int(receipt.status) != 1:
        raise RuntimeError("allowlistToken fallo")
    return web3.to_hex(tx_hash)


def maybe_allowlist_token(web3: Web3, router_addr: str, token_addr: str, owner_pk: str) -> str | None:
    abi = [
        {
            "inputs": [{"internalType": "address", "name": "token", "type": "address"}],
            "name": "allowlistToken",
            "outputs": [],
            "stateMutability": "nonpayable",
            "type": "function",
        },
        {
            "inputs": [{"internalType": "address", "name": "", "type": "address"}],
            "name": "allowlistedTokens",
            "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
            "stateMutability": "view",
            "type": "function",
        },
        {
            "inputs": [],
            "name": "owner",
            "outputs": [{"internalType": "address", "name": "", "type": "address"}],
            "stateMutability": "view",
            "type": "function",
        },
    ]

    router = web3.eth.contract(address=router_addr, abi=abi)
    if bool(router.functions.allowlistedTokens(token_addr).call()):
        return None

    owner_pk_norm = owner_pk if owner_pk.startswith("0x") else f"0x{owner_pk}"
    owner_addr = web3.eth.account.from_key(owner_pk_norm).address
    onchain_owner = router.functions.owner().call()
    if owner_addr.lower() != onchain_owner.lower():
        raise RuntimeError(
            f"La clave no es owner del router {router_addr}. owner_onchain={onchain_owner}, owner_key={owner_addr}"
        )

    return send_allowlist_tx(web3, router, owner_addr, owner_pk_norm, token_addr)


def main() -> None:
    load_env()

    parser = argparse.ArgumentParser(description="Deploy de AccEURMock para red ISBE")
    parser.add_argument("--rpc-url", default=os.getenv("ISBE_RPC_URL", ""), help="RPC de ISBE")
    parser.add_argument("--private-key", default=os.getenv("ISBE_DEPLOYER_PRIVATE_KEY", ""), help="Private key deployer")
    parser.add_argument("--name", default="Accuro Euro", help="Nombre del token")
    parser.add_argument("--symbol", default="AccEUR", help="Simbolo del token")
    parser.add_argument("--initial-owner", default="", help="Owner inicial; por defecto deployer")
    parser.add_argument("--initial-mint", default="1000000", help="Supply inicial en formato decimal humano")
    parser.add_argument("--max-supply", default="100000000", help="Supply maximo en formato decimal humano")
    parser.add_argument(
        "--mint-to",
        action="append",
        default=[],
        help="Direccion para mintear adicionalmente. Repetible: --mint-to 0x.. --mint-to 0x..",
    )
    parser.add_argument("--mint-amount", default="10000", help="Cantidad para cada --mint-to")
    parser.add_argument("--funding-router", default=os.getenv("FUNDING_ROUTER_ADDRESS", ""), help="Router funding opcional")
    parser.add_argument("--send-router", default=os.getenv("SEND_ROUTER_ADDRESS", ""), help="Router send opcional")
    parser.add_argument(
        "--router-owner-private-key",
        default=os.getenv("ROUTER_OWNER_PRIVATE_KEY", ""),
        help="Private key owner de routers para allowlist token",
    )

    args = parser.parse_args()

    if not args.rpc_url:
        raise RuntimeError("Falta --rpc-url o ISBE_RPC_URL")
    if not args.private_key:
        raise RuntimeError("Falta --private-key o ISBE_DEPLOYER_PRIVATE_KEY")

    pk = args.private_key if args.private_key.startswith("0x") else f"0x{args.private_key}"
    web3 = Web3(Web3.HTTPProvider(args.rpc_url, request_kwargs={"timeout": 30}))
    if not web3.is_connected():
        raise RuntimeError(f"No se pudo conectar al RPC: {args.rpc_url}")

    deployer = web3.eth.account.from_key(pk).address
    owner = to_checksum(args.initial_owner, "initial_owner") if args.initial_owner else deployer

    initial_supply_raw = parse_units(args.initial_mint, 6)
    max_supply_raw = parse_units(args.max_supply, 6)
    extra_mint_raw = parse_units(args.mint_amount, 6)

    if initial_supply_raw > max_supply_raw:
        raise RuntimeError("initial-mint no puede ser mayor que max-supply")

    abi, bytecode = compile_contract()
    contract = web3.eth.contract(abi=abi, bytecode=bytecode)

    nonce = web3.eth.get_transaction_count(deployer, "pending")
    tx = contract.constructor(args.name, args.symbol, owner, initial_supply_raw, max_supply_raw).build_transaction(
        {
            "from": deployer,
            "nonce": nonce,
            "gasPrice": int(web3.eth.gas_price),
            "chainId": int(web3.eth.chain_id),
        }
    )

    gas_estimate = int(web3.eth.estimate_gas(tx))
    tx["gas"] = int(gas_estimate * 1.25)

    signed = web3.eth.account.sign_transaction(tx, pk)
    tx_hash = web3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = web3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)

    if int(receipt.status) != 1:
        raise RuntimeError("Deploy fallo")

    token_address = to_checksum(receipt.contractAddress, "token_address")
    token = web3.eth.contract(address=token_address, abi=abi)

    print("=== DEPLOY OK ===")
    print(f"chain_id: {web3.eth.chain_id}")
    print(f"deployer: {deployer}")
    print(f"token: {token_address}")
    print(f"symbol: {args.symbol}")
    print(f"decimals: {token.functions.decimals().call()}")
    print(f"max_supply_raw: {token.functions.maxSupply().call()}")
    print(f"deploy_tx: {web3.to_hex(tx_hash)}")

    owner_for_mint_pk = pk
    owner_for_mint_addr = owner
    if owner_for_mint_addr.lower() != deployer.lower():
        print("WARN: owner inicial distinto del deployer. Se omite mint adicional automatico.")
    else:
        nonce = web3.eth.get_transaction_count(owner_for_mint_addr, "pending")
        for idx, target in enumerate(args.mint_to):
            target_addr = to_checksum(target, f"mint_to[{idx}]")
            mint_tx = token.functions.mint(target_addr, extra_mint_raw).build_transaction(
                {
                    "from": owner_for_mint_addr,
                    "nonce": nonce,
                    "gasPrice": int(web3.eth.gas_price),
                    "chainId": int(web3.eth.chain_id),
                }
            )
            mint_gas = int(web3.eth.estimate_gas(mint_tx))
            mint_tx["gas"] = int(mint_gas * 1.2)
            signed_mint = web3.eth.account.sign_transaction(mint_tx, owner_for_mint_pk)
            mint_hash = web3.eth.send_raw_transaction(signed_mint.raw_transaction)
            mint_receipt = web3.eth.wait_for_transaction_receipt(mint_hash, timeout=180)
            if int(mint_receipt.status) != 1:
                raise RuntimeError(f"Mint fallo para {target_addr}")
            print(f"mint_ok: to={target_addr} amount={args.mint_amount} tx={web3.to_hex(mint_hash)}")
            nonce += 1

    router_owner_pk = args.router_owner_private_key.strip()
    if router_owner_pk:
        if args.funding_router and Web3.is_address(args.funding_router):
            txh = maybe_allowlist_token(web3, to_checksum(args.funding_router, "funding_router"), token_address, router_owner_pk)
            if txh:
                print(f"funding_router_allowlist_tx: {txh}")
            else:
                print("funding_router_allowlist: ya estaba activo")

        if args.send_router and Web3.is_address(args.send_router):
            txh = maybe_allowlist_token(web3, to_checksum(args.send_router, "send_router"), token_address, router_owner_pk)
            if txh:
                print(f"send_router_allowlist_tx: {txh}")
            else:
                print("send_router_allowlist: ya estaba activo")
    else:
        print("INFO: sin --router-owner-private-key; no se hizo allowlist en routers.")

    print("=== ENV APP (copiar) ===")
    print(f"NEXT_PUBLIC_USDT_CONTRACT={token_address}")
    print(f"FUNDING_ROUTER_USDT_CONTRACT={token_address}")


if __name__ == "__main__":
    main()
