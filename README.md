# Accuro Routers — ISBE Modalidad 2

Contratos de routing atómico de stablecoins de Accuro, adaptados a la **Modalidad 2 de ISBE (contrato propio homologado)**: despliegue directo con RBAC y pausabilidad gestionada por la gobernanza de ISBE.

## Contratos

| Contrato | Descripción |
|---|---|
| `TreasuryRouterV1` | Split atómico de fondos: principal → reserva, comisión → recipient de comisión, en una sola tx ("all or nothing"). Recipients sujetos a allowlist. |
| `SendRouterV1` | Send P2P atómico con recipient dinámico (sin allowlist) y comisión a recipient allowlisted. |
| `TreasuryRouterV2` | Extiende el split con referral opcional, escrow on-chain y liberación de rewards por ejecutores autorizados. Compatible con RBAC y pausabilidad ISBE. |
| `SendRouterV2` | Send P2P con las protecciones de V1 y funciones administrativas de rescate protegidas por `DEFAULT_ADMIN_ROLE`. Compatible con RBAC y pausabilidad ISBE. |
| `AccEURMock` | ERC20 de pruebas (6 decimales, estilo USDT). **Solo testing, no se homologa.** |

Ambos routers comparten protecciones: anti-replay (`groupId` consumido + nonce por payer), deadline, allowlists de tokens/recipients, `nonReentrant`, `whenNotPaused` y `msg.sender == payer`.

## Conformidad ISBE (Modalidad 2)

- **RBAC** — OpenZeppelin `AccessControl` (expone `IAccessControl.hasRole`). Roles: `DEFAULT_ADMIN_ROLE`, `ALLOWLIST_ADMIN_ROLE`, `PAUSER_ROLE`. Detalle completo en [ROLES.md](./ROLES.md).
- **Pausabilidad** — OpenZeppelin `Pausable`, expone `pause()`/`unpause()` bajo `PAUSER_ROLE`. La dirección de gobernanza de ISBE (`0x...15BE`) recibe `PAUSER_ROLE` en el constructor (condición de homologación). Verificado en red: el diamante de gobernanza pausa/despausa los routers vía `pauseIsbe`/`unpauseIsbe` (ruta Modalidad 2, contrato no registrado).
- **Análisis estático** — Slither sin hallazgos críticos abiertos. Triaje en [SLITHER_REPORT.md](./SLITHER_REPORT.md).
- **Tests** — 53 tests (RBAC, pausas, validaciones, atomicidad, anti-replay). Cobertura en `coverage/`.
- **Build reproducible** — solc `0.8.28`, optimizer enabled (runs: 200), `bytecodeHash: ipfs`. Metadata en `artifacts/build-info/` tras compilar.
- **Análisis de gaps original** — [ANALISIS_MODALIDAD2.md](./ANALISIS_MODALIDAD2.md).

## Requisitos

- Node.js 18+
- `npm install`

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

## Comandos

```bash
npx hardhat compile                       # compilar
npx hardhat test                          # 53 tests
npx hardhat coverage                      # reporte de cobertura
npx hardhat run scripts/deploy.ts --network isbe     # desplegar
npx hardhat run scripts/interact.ts --network isbe   # probar transacciones
npx hardhat run scripts/deploy-v2.ts --network isbe # desplegar routers V2
npx hardhat run scripts/interact-v2.ts --network isbe # probar referral, escrow y pausa V2
```

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

Registro completo (admin, gobernanza, compiler) en `deployments/isbe.json`.

## Estructura

```
contracts/          TreasuryRouterV1, SendRouterV1, AccEURMock
scripts/            deploy.ts, interact.ts (deploy_acceur_isbe.py: legacy)
test/               suites de ambos routers (53 tests)
deployments/        registros de despliegue por red
ANALISIS_MODALIDAD2.md   análisis de gaps y plan de adaptación
ROLES.md                 documentación RBAC (expediente ISBE)
SLITHER_REPORT.md        análisis estático con triaje (expediente ISBE)
```

## Documentación ISBE

- [Modalidad 2: Contrato propio homologado](https://docs.redisbe.com/documentation/smart-contracts/modalidades/contrato-propio)
- [Desarrollo de Contratos Custom](https://docs.redisbe.com/documentation/smart-contracts/contratos-custom)
