# Deploy AccEUR en ISBE (testing)

Este flujo despliega un token ERC20 con 6 decimales para simular USDT en la red ISBE y dejarlo compatible con la app actual.

## 1) Contrato

Archivo: contracts/AccEURMock.sol

Propiedades principales:
- Nombre configurable (ej: Accuro Euro)
- Simbolo configurable (ej: AccEUR)
- Decimales fijos: 6 (compatible con flujos USDT)
- Max supply inmutable (cap anti-emision ilimitada)
- Funciones ERC20 necesarias para la app: transfer, approve, transferFrom, allowance, balanceOf, decimals
- RBAC (AccessControl): DEFAULT_ADMIN_ROLE, MINTER_ROLE y PAUSER_ROLE
- Pausable (OpenZeppelin) con PAUSER_ROLE asignado a la gobernanza de ISBE

## 2) Dependencias

Mismo toolchain que los routers (requisito de build reproducible):

npm install

## 3) Variables sugeridas

En .env:

ISBE_RPC_URL=https://tu-rpc-isbe
ACCOUNT_PRIVATE_KEY=0x...
ADMIN_ADDRESS=0x...
ISBE_GOVERNANCE_ADDRESS=0x...
TOKEN_NAME=Accuro Euro
TOKEN_SYMBOL=AccEUR
INITIAL_MINT=1000000
MAX_SUPPLY=100000000

## 4) Deploy

npx hardhat run scripts/deploy-token.ts --network isbe

Opcional: mintear a wallets de pruebas

MINT_TO=0xWallet1,0xWallet2 MINT_AMOUNT=50000 npx hardhat run scripts/deploy-token.ts --network isbe

Opcional: allowlist automatico en los routers ya registrados en deployments/

ALLOWLIST_ROUTERS=true npx hardhat run scripts/deploy-token.ts --network isbe

## 4.1) Hardening recomendado tras deploy

- Asignar DEFAULT_ADMIN_ROLE al multisig y revocarlo de la cuenta de despliegue
- Mantener MINTER_ROLE solo en la cuenta emisora; si ya no se emite mas, ejecutar disableMinting()
- Verificar que la gobernanza de ISBE conserva PAUSER_ROLE (el script aborta si no lo tiene)

## 5) Integración con app

Tras el deploy, el script imprime:

NEXT_PUBLIC_USDT_CONTRACT=0xTokenAccEUR
FUNDING_ROUTER_USDT_CONTRACT=0xTokenAccEUR

Actualiza:
- wallet_talk_js/.env.local: NEXT_PUBLIC_USDT_CONTRACT
- Back/.env: FUNDING_ROUTER_USDT_CONTRACT

Si usas routers atomicos:
- El token debe estar allowlisted en los routers desplegados
- Puedes usar ALLOWLIST_ROUTERS=true para que el script lo haga automaticamente

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

## 8) Token desplegado en pre

El token `0x77A6c74bcF0fc7EBa5d66775D899F5A7a3F380C0` (`AccEUR`, 6 decimales)
es una versión anterior basada en `owner`, no la versión RBAC actual. Su owner
puede ejecutar `mint` mientras el token no esté pausado y
`mintingDisabled == false`. No se debe intentar consultar `MINTER_ROLE` en ese
despliegue.

Para nuevos despliegues se usa exclusivamente `scripts/deploy-token.ts`, que
despliega la versión actual con `DEFAULT_ADMIN_ROLE`, `MINTER_ROLE` y
`PAUSER_ROLE`. El flujo completo de pre se valida con
`scripts/smoke-pre-v2.ts`; las claves de las wallets operativas se leen desde
un JSON local bajo `wallets/`, nunca desde archivos versionados.
