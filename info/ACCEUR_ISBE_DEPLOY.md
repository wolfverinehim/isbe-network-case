# Deploy AccEUR en ISBE (testing)

Este flujo despliega un token ERC20 mock con 6 decimales para simular USDT en la red ISBE y dejarlo compatible con la app actual.

## 1) Contrato

Archivo: Back/contracts/AccEURMock.sol

Propiedades principales:
- Nombre configurable (ej: Accuro Euro)
- Simbolo configurable (ej: AccEUR)
- Decimales fijos: 6 (compatible con flujos USDT)
- Max supply inmutable (cap anti-emision ilimitada)
- Funciones ERC20 necesarias para la app: transfer, approve, transferFrom, allowance, balanceOf, decimals
- Mint por owner para pruebas
- Pausable por owner
- Ownership en 2 pasos (transferOwnership + acceptOwnership)

## 2) Dependencias

En el entorno Python del backend:

pip install py-solc-x

## 3) Variables sugeridas

En Back/.env para evitar pasar todo por CLI:

ISBE_RPC_URL=https://tu-rpc-isbe
ISBE_DEPLOYER_PRIVATE_KEY=0x...
FUNDING_ROUTER_ADDRESS=0x...
SEND_ROUTER_ADDRESS=0x...
ROUTER_OWNER_PRIVATE_KEY=0x...

## 4) Deploy

Desde la carpeta Back:

python tools/deploy_acceur_isbe.py --name "Accuro Euro" --symbol "AccEUR" --initial-mint 1000000 --max-supply 100000000

Opcional: mintear a wallets de pruebas

python tools/deploy_acceur_isbe.py \
  --name "Accuro Euro" \
  --symbol "AccEUR" \
  --initial-mint 1000000 \
  --max-supply 100000000 \
  --mint-to 0xWallet1 \
  --mint-to 0xWallet2 \
  --mint-amount 50000

Opcional: allowlist automático en routers (si pasas la private key del owner del router)

python tools/deploy_acceur_isbe.py \
  --name "Accuro Euro" \
  --symbol "AccEUR" \
  --initial-mint 1000000 \
  --max-supply 100000000 \
  --router-owner-private-key 0x...

## 4.1) Hardening recomendado tras deploy

- Transferir ownership a multisig (safe) usando flujo 2 pasos:
  - owner actual: transferOwnership(nuevoOwner)
  - nuevoOwner: acceptOwnership()
- Si ya no necesitas emitir mas tokens en pruebas, ejecutar disableMinting()
- Mantener pause/unpause solo en cuenta de control operacional

## 5) Integración con app

Tras el deploy, el script imprime:

NEXT_PUBLIC_USDT_CONTRACT=0xTokenAccEUR
FUNDING_ROUTER_USDT_CONTRACT=0xTokenAccEUR

Actualiza:
- wallet_talk_js/.env.local: NEXT_PUBLIC_USDT_CONTRACT
- Back/.env: FUNDING_ROUTER_USDT_CONTRACT

Si usas routers atómicos:
- El token debe estar allowlisted en TreasuryRouterV1 y SendRouterV1
- Puedes usar el flag --router-owner-private-key para que el script lo haga automáticamente

## 6) Validación rápida

- Balance token:
  - En frontend, abrir send/deposit/card y verificar balance del token
- Allowance + route:
  - Ejecutar pruebas de send y card deposit
- Decimales:
  - Verificar que 1.00 AccEUR se maneje como 1,000,000 unidades internas

## 7) Nota operativa

La UI seguirá mostrando textos "USDT" en varias pantallas (i18n y labels), pero operará contra el contrato que pongas en NEXT_PUBLIC_USDT_CONTRACT.
Para pruebas funcionales no hace falta cambiar textos.
