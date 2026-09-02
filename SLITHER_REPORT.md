# Reporte de análisis estático — Slither

**Fecha:** 2026-09-02
**Herramienta:** Slither v0.11.6 (102 detectores)
**Alcance:** `contracts/TreasuryRouterV1.sol`, `contracts/SendRouterV1.sol`, `contracts/TreasuryRouterV2.sol`, `contracts/SendRouterV2.sol`, `contracts/AccEURMock.sol` (+ dependencias OpenZeppelin 4.9.6, excluidas del reporte con `--filter-paths node_modules`)
**Compilador:** solc 0.8.28, optimizer enabled (runs: 200)
**Comando:** `slither . --filter-paths "node_modules"`

## Resultado global

**22 hallazgos, 0 críticos abiertos.** Se clasifican en 5 categorías, todas analizadas y justificadas a continuación. Cumple el requisito de conformidad ISBE de "análisis estático sin hallazgos críticos abiertos".

`AccEURMock` no genera ningún hallazgo tras su adaptación a Modalidad 2.

| Detector | Impacto Slither | Ocurrencias | Estado |
|---|---|---|---|
| `arbitrary-send-erc20` | High | 11 | **Falso positivo — mitigado por diseño** |
| `arbitrary-send-eth` | High | 1 | **Falso positivo — restringido por RBAC** |
| `reentrancy-benign` | Low | 1 | **Mitigado — `nonReentrant`** |
| `timestamp` | Low | 8 | **Aceptado — inherente al diseño de deadlines** |
| `low-level-calls` | Informational | 1 | **Aceptado — patrón recomendado para envio de nativo** |

## Triaje de hallazgos

### 1. `arbitrary-send-erc20` (11 ocurrencias) — FALSO POSITIVO

**Hallazgo:** las funciones de routing llaman a `safeTransferFrom(req.payer, ...)` donde `req.payer` proviene de calldata, lo que Slither interpreta como "from arbitrario" (riesgo de drenar fondos de terceros que hayan aprobado el router).

**Justificación:** todas validan como primera comprobación:

```solidity
require(msg.sender == req.payer, "Caller must be payer");
```

Por tanto el `from` del `transferFrom` es **siempre `msg.sender`**: nadie puede mover fondos de un tercero. Slither no propaga esta restricción al analizar el flujo. Cubierto por los tests `"revierte si el caller no es el payer"` en las suites de los cuatro routers.

**Mitigaciones adicionales:** tokens y recipients sujetos a allowlist gestionada por `ALLOWLIST_ADMIN_ROLE`; `nonReentrant` y `whenNotPaused` en todas las funciones de routing.

### 2. `arbitrary-send-eth` (1 ocurrencia) — FALSO POSITIVO

**Hallazgo:** `SendRouterV2.rescueNative` envía nativo a una dirección recibida por parámetro.

**Justificación:** es una función de rescate restringida a `DEFAULT_ADMIN_ROLE`, con `nonReentrant`, `whenNotPaused`, validación de destinatario distinto de `address(0)`, importe mayor que cero y comprobación de saldo. El destino es arbitrario por diseño: sirve precisamente para recuperar fondos enviados por error. Emite `NativeRescued` para trazabilidad.

### 3. `reentrancy-benign` (1 ocurrencia) — MITIGADO

**Hallazgo:** en `TreasuryRouterV2.routeFundingWithReferral` la escritura de `_referralEscrowByRouteAndToken` ocurre después de las llamadas externas de transferencia.

**Justificación:** la función lleva `nonReentrant`, por lo que no es reentrable. Además el anti-replay (`consumedRouteKeys` y `payerNonces`) se consume **antes** de cualquier llamada externa, en `_validateAndConsumeBaseRoute`. La escritura posterior solo acumula el saldo de escrow sobre el importe ya transferido.

### 4. `timestamp` (8 ocurrencias) — ACEPTADO

**Hallazgo:** uso de `block.timestamp` para comparar contra el `deadline` en las funciones de routing y en sus equivalentes `view`.

**Justificación:** el deadline es un mecanismo de expiración de requests con granularidad de minutos/horas. La manipulación del timestamp por un validador (segundos en redes QBFT/Besu con bloques regulares) no supone ventaja económica: solo podría acelerar marginalmente la expiración de una request. Es el patrón estándar de deadlines (idéntico al de Uniswap et al.).

### 5. `low-level-calls` (1 ocurrencia) — ACEPTADO

**Hallazgo:** `to.call{value: amount}("")` en `SendRouterV2.rescueNative`.

**Justificación:** es la forma recomendada de enviar nativo, frente a `transfer`/`send`, que fijan un límite de 2300 gas y fallan con destinatarios que sean contratos o multisigs. El resultado se comprueba con `require(ok, "Native transfer failed")`.

## Hallazgos resueltos

Corregidos tras esta ejecución (2026-09-02):

- **`solc-version` (2 ocurrencias)** — `SendRouterV2` y `TreasuryRouterV2` usaban `pragma ^0.8.20`, con issues severos conocidos. Fijado a `0.8.28` exacto en los cinco contratos, alineado con `hardhat.config.ts` (requisito de build reproducible).
- **`redundant-statements` (1 ocurrencia)** — sentencia `routeKey;` en `TreasuryRouterV2.routeFunding` usada para silenciar un aviso; eliminada dejando de asignar el valor de retorno no utilizado.

Corregidos en el refactor a Modalidad 2 (2026-07-08):

- Doble sistema de pausa (herencia de `Pausable` OZ sin uso + flag propio `isPaused`) → eliminado; ahora se usa exclusivamente `Pausable` de OZ con `whenNotPaused` y `pause()/unpause()` bajo `PAUSER_ROLE`.
- `Ownable` (punto único de fallo) → sustituido por `AccessControl` con separación de privilegios en los cuatro routers y en `AccEURMock`.

## Reproducción

```bash
pip install slither-analyzer
cd accuro
slither . --filter-paths "node_modules"
```
