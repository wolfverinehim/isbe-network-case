# Accuro Routers — ISBE Modalidad 2

Contratos de routing atómico de stablecoins de Accuro, adaptados a la **Modalidad 2 de ISBE (contrato propio homologado)**: despliegue directo con RBAC y pausabilidad gestionada por la gobernanza de ISBE.

## Contratos

| Contrato | Descripción |
|---|---|
| `TreasuryRouterV1` | Split atómico de fondos: principal → reserva, comisión → recipient de comisión, en una sola tx ("all or nothing"). Recipients sujetos a allowlist. |
| `SendRouterV1` | Send P2P atómico con recipient dinámico (sin allowlist) y comisión a recipient allowlisted. |
| `TreasuryRouterV2` | Extiende el split con referral opcional, escrow on-chain y liberación de rewards por ejecutores autorizados. Compatible con RBAC y pausabilidad ISBE. |
| `SendRouterV2` | Send P2P con las protecciones de V1 y funciones administrativas de rescate protegidas por `DEFAULT_ADMIN_ROLE`. Compatible con RBAC y pausabilidad ISBE. |
| `AccEURMock` | ERC20 de pruebas (6 decimales, estilo USDT). Adaptado a Modalidad 2: `AccessControl` + `Pausable` con `PAUSER_ROLE` para ISBE. |

Los cuatro routers comparten protecciones: anti-replay (`groupId` consumido + nonce por payer), deadline, allowlists de tokens/recipients, `nonReentrant`, `whenNotPaused` y `msg.sender == payer`.

## Conformidad ISBE (Modalidad 2)

- **RBAC** — OpenZeppelin `AccessControl` (expone `IAccessControl.hasRole`). Roles: `DEFAULT_ADMIN_ROLE`, `ALLOWLIST_ADMIN_ROLE`, `PAUSER_ROLE`. Detalle completo en [ROLES.md](./ROLES.md).
- **Pausabilidad** — OpenZeppelin `Pausable`, expone `pause()`/`unpause()` bajo `PAUSER_ROLE`. La dirección de gobernanza de ISBE (`0x...15BE`) recibe `PAUSER_ROLE` en el constructor (condición de homologación). Verificado en red: el diamante de gobernanza pausa/despausa los routers vía `pauseIsbe`/`unpauseIsbe` (ruta Modalidad 2, contrato no registrado).
- **Análisis estático** — Slither sin hallazgos críticos abiertos. Triaje en [SLITHER_REPORT.md](./SLITHER_REPORT.md).
- **Tests** — 92 tests (RBAC, pausas, validaciones, atomicidad, anti-replay y ERC20). Cobertura en `coverage/`.
- **Build reproducible** — solc `0.8.28`, optimizer enabled (runs: 200), `bytecodeHash: ipfs`. Metadata en `artifacts/build-info/` tras compilar.
- **Análisis de gaps original** — [ANALISIS_MODALIDAD2.md](./ANALISIS_MODALIDAD2.md).

## Requisitos

- Node.js 18+
- `npm install`
- Docker Desktop iniciado
- Bash (WSL en Windows) y `jq`

## Red ISBE local

El repositorio incluye los scripts para levantar una red Besu/QBFT local de
cuatro nodos. Las claves privadas de los validadores y las bases de datos de
los nodos están excluidas de Git por seguridad; para arrancar desde un clon
limpio necesitas restaurar un paquete de red privado que contenga
`isbe-network-case/QBFT-Network/` con sus datos.

En Windows, abre Ubuntu/WSL y ejecuta desde la raíz del repositorio:

```bash
sudo apt-get update && sudo apt-get install -y jq
cd /mnt/f/TFS/accuro
bash ./isbe-network-case/startNetwork.sh
```

En Linux o macOS:

```bash
sudo apt-get install jq       # Linux Debian/Ubuntu; en macOS usa brew install jq
cd /ruta/al/repositorio
bash ./isbe-network-case/startNetwork.sh
```

El arranque crea la red Docker `besu-network`, inicia el bootnode en
`http://localhost:8545` y los validadores en los puertos `8546` a `8548`.
La red usa `chainId=11073`. Verifica el estado con:

```bash
docker ps --filter label=project=besu
curl -s -X POST http://localhost:8545 \
	-H 'Content-Type: application/json' \
	--data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
```

Para detenerla:

```bash
bash ./isbe-network-case/stopNetwork.sh
```

Después de levantar la red, copia `.env.example` a `.env`, completa los
valores localmente y ejecuta la compilación y los tests antes de desplegar:

```bash
npm install
npx hardhat compile
npx hardhat test
npx hardhat run scripts/deploy.ts --network isbe
```

No publiques `.env`, claves de validadores ni paquetes de red exportados.

## Configuración (`.env`)

```bash
ISBE_RPC_URL=http://localhost:8545        # RPC de la red ISBE
CHAIN_ID=11073
ACCOUNT_PRIVATE_KEY=0x...                 # clave del signer (deployer/payer)
ISBE_GOVERNANCE_ADDRESS=0x00000000000000000000000000000000000015BE  # obligatoria para desplegar
ADMIN_ADDRESS=0x...                       # admin de los routers (default: deployer)

# Opcionales (deploy/interact)
DEPLOY_MOCK_TOKEN=true                    # despliega AccEURMock y lo allowlista
TOKEN_ADDRESS=0x...                       # usar un token ya desplegado
RESERVE_RECIPIENT=0x...
COMMISSION_RECIPIENT=0x...
RECIPIENT=0x...                           # destinatario P2P para interact.ts
```

### Entorno pre (ISBE BaaS)

La red `pre` usa `chainId=11073` y el endpoint definido en `PRE_RPC_URL`. La
configuración de Hardhat añade la cabecera `chain_id` requerida por el BaaS.
Las URLs autenticadas y claves privadas deben permanecer exclusivamente en
`.env`; nunca se registran en `deployments/` ni en Git.

```bash
PRE_RPC_URL=https://baas.pre.portal.redisbe.com/YOUR_ENDPOINT_KEY
PRE_CHAIN_ID=11073
PRE_ACCOUNT_PRIVATE_KEY=0x...
TREASURY_ROUTER_V1=0x43eBf9bC0e5aC8688C598F75d85Be6Ef8Fda67d1
SEND_ROUTER_V1=0x5189d395754b15e9E05e10Ed4461135cCad39F3b
TREASURY_ROUTER_V2=0xD20cd6F82ff5F9B946C026cd846A1E78C4f1483F
SEND_ROUTER_V2=0xf66573dc1096F4B538b38732d642Dde97Fc720c7
TOKENS=0x77A6c74bcF0fc7EBa5d66775D899F5A7a3F380C0
RECIPIENTS=0xRESERVE,0xCOMMISSION,0xREFERRAL
```

El token desplegado en pre es una versión anterior de `AccEURMock`, gobernada
por `owner`; no expone `MINTER_ROLE`. La wallet administradora desplegada es su
owner y puede mintear mientras `paused == false` y `mintingDisabled == false`.
Los nuevos despliegues deben usar la versión RBAC actual de
`contracts/AccEURMock.sol`.

## Comandos

```bash
npx hardhat compile                       # compilar
npx hardhat test                          # 92 tests
npx hardhat coverage                      # reporte de cobertura
npx hardhat run scripts/deploy.ts --network isbe     # desplegar
npx hardhat run scripts/interact.ts --network isbe   # probar transacciones
npx hardhat run scripts/deploy-v2.ts --network isbe # desplegar routers V2
npx hardhat run scripts/interact-v2.ts --network isbe # probar referral, escrow y pausa V2
npx hardhat run scripts/deploy-token.ts --network isbe # desplegar AccEURMock
npx hardhat run scripts/allowlist.ts --network pre # gestionar allowlists en pre
npx hardhat run scripts/configure-v2.ts --network pre # configurar escrow V2
npx hardhat run scripts/fund-gas.ts --network pre # fondear cuentas operativas
npx hardhat run scripts/new-wallet.ts # generar wallets EOA de pruebas
npx hardhat run scripts/smoke-pre-v2.ts --network pre # smoke completo V2
```

### Operación en pre

- `scripts/allowlist.ts` gestiona altas y bajas (`REMOVE=true`) de tokens y
	recipients, soporta `DRY_RUN=true` y `ONLY_ROUTERS=...`, y es idempotente.
- `scripts/configure-v2.ts` configura `releaseExecutor` y la wallet de fallback
	del escrow en `TreasuryRouterV2`.
- `scripts/fund-gas.ts` completa el saldo de las cuentas hasta `AMOUNT`, sin
	duplicar fondos en reejecuciones.
- `scripts/new-wallet.ts` genera wallets compatibles con MetaMask y guarda las
	claves bajo `wallets/`, carpeta excluida de Git.
- `scripts/smoke-pre-v2.ts` usa admin, payer y release executor separados para
	validar mint, approvals, funding con escrow, release y send P2P.

El smoke V2 se ejecutó correctamente el 2026-09-02. El token y los recipients
de reserva, comisión y referral quedaron allowlisted; el propio
`TreasuryRouterV2` quedó allowlisted en sí mismo para admitir
`referralRecipient == address(this)`. El ejecutor de releases y la wallet de
fallback también quedaron configurados. El estado público se conserva en
`deployments/pre.json`.

### Routers V2

Los routers V2 fueron adaptados a Modalidad 2: usan `AccessControl`, exponen
`IAccessControl.hasRole`, asignan `PAUSER_ROLE` a la gobernanza recibida en el
constructor y exponen `pause()`/`unpause()`. El `TreasuryRouterV2` requiere,
además, configurar `releaseExecutors` y la wallet de fallback antes de liberar
rewards. Las funciones de rescate y configuración de rewards requieren
`DEFAULT_ADMIN_ROLE`.

### Despliegue (`scripts/deploy.ts`)

Despliega ambos routers con `constructor(admin, isbeGovernance)`, verifica on-chain que la gobernanza ISBE tiene `PAUSER_ROLE` (aborta si no), configura allowlists opcionales y guarda el registro en `deployments/<red>.json`.

Nota: si `ADMIN_ADDRESS` ≠ deployer, el script no puede configurar allowlists (requieren `ALLOWLIST_ADMIN_ROLE`); hacerlo después desde la cuenta admin.

### Pruebas de transacciones (`scripts/interact.ts`)

Lee las direcciones de `deployments/<red>.json`, despliega un token mock si no se indica `TOKEN_ADDRESS`, completa allowlists (si el signer tiene rol), y ejecuta: `routeFunding`, `routeSend` y una verificación anti-replay, comprobando balances.

## Despliegues

| Red | Contrato | Dirección |
|---|---|---|
| ISBE dev (chainId 11073) | TreasuryRouterV1 | `0x2B3294DBE904f6478915d1a38eb649B90AB2A5Fe` |
| ISBE dev (chainId 11073) | SendRouterV1 | `0x2eB330d4c88B26455E81Bf2E807a737A21113be9` |
| ISBE pre (chainId 11073) | TreasuryRouterV1 | `0x43eBf9bC0e5aC8688C598F75d85Be6Ef8Fda67d1` |
| ISBE pre (chainId 11073) | SendRouterV1 | `0x5189d395754b15e9E05e10Ed4461135cCad39F3b` |
| ISBE pre (chainId 11073) | TreasuryRouterV2 | `0xD20cd6F82ff5F9B946C026cd846A1E78C4f1483F` |
| ISBE pre (chainId 11073) | SendRouterV2 | `0xf66573dc1096F4B538b38732d642Dde97Fc720c7` |
| ISBE pre (chainId 11073) | AccEUR (legacy) | `0x77A6c74bcF0fc7EBa5d66775D899F5A7a3F380C0` |

Registros públicos en `deployments/isbe.json` y `deployments/pre.json`. No
contienen endpoints autenticados, mnemónicos ni claves privadas.

## Estructura

```
contracts/          TreasuryRouterV1/V2, SendRouterV1/V2, AccEURMock
scripts/            deploy/interact, allowlist, configure-v2, fund-gas, new-wallet y smoke-pre-v2
test/               suites de los cuatro routers y del token (92 tests)
deployments/        registros de despliegue por red
ANALISIS_MODALIDAD2.md   análisis de gaps y plan de adaptación
ROLES.md                 documentación RBAC (expediente ISBE)
SLITHER_REPORT.md        análisis estático con triaje (expediente ISBE)
```

## Documentación ISBE

- [Modalidad 2: Contrato propio homologado](https://docs.redisbe.com/documentation/smart-contracts/modalidades/contrato-propio)
- [Desarrollo de Contratos Custom](https://docs.redisbe.com/documentation/smart-contracts/contratos-custom)
