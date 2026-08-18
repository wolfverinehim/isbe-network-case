# Reporte de análisis estático — Slither

**Fecha:** 2026-07-08
**Herramienta:** Slither v0.11.5 (101 detectores)
**Alcance:** `contracts/TreasuryRouterV1.sol`, `contracts/SendRouterV1.sol`, `contracts/AccEURMock.sol` (+ dependencias OpenZeppelin 4.9.6, excluidas del reporte con `--filter-paths node_modules`)
**Compilador:** solc 0.8.28, optimizer enabled (runs: 200)
**Comando:** `slither . --filter-paths "node_modules"`

## Resultado global

**8 hallazgos, 0 críticos abiertos.** Los 8 se clasifican en 2 categorías, ambas analizadas y justificadas a continuación. Cumple el requisito de conformidad ISBE de "análisis estático sin hallazgos críticos abiertos".

| Detector | Impacto Slither | Ocurrencias | Estado |
|---|---|---|---|
| `arbitrary-send-erc20` | High | 4 (2 por router) | **Falso positivo — mitigado por diseño** |
| `timestamp` | Low | 4 (2 por router) | **Aceptado — inherente al diseño de deadlines** |

## Triaje de hallazgos

### 1. `arbitrary-send-erc20` (4 ocurrencias) — FALSO POSITIVO

**Hallazgo:** `routeFunding` y `routeSend` llaman a `safeTransferFrom(req.payer, ...)` donde `req.payer` proviene de calldata, lo que Slither interpreta como "from arbitrario" (riesgo de drenar fondos de terceros que hayan aprobado el router).

**Justificación:** ambas funciones validan como primera comprobación:

```solidity
require(msg.sender == req.payer, "Caller must be payer");
```

Por tanto el `from` del `transferFrom` es **siempre `msg.sender`**: nadie puede mover fondos de un tercero. Slither no propaga esta restricción al analizar el flujo. Cubierto por los tests `"revierte si el caller no es el payer"` en ambas suites.

**Mitigaciones adicionales:** tokens y recipients de comisión sujetos a allowlist gestionada por `ALLOWLIST_ADMIN_ROLE`; `nonReentrant` y `whenNotPaused` en ambas funciones.

### 2. `timestamp` (4 ocurrencias) — ACEPTADO

**Hallazgo:** uso de `block.timestamp` para comparar contra `req.deadline` en `routeFunding`/`canRoute` y `routeSend`/`canRouteSend`.

**Justificación:** el deadline es un mecanismo de expiración de requests con granularidad de minutos/horas. La manipulación del timestamp por un validador (segundos en redes QBFT/Besu con bloques regulares) no supone ventaja económica: solo podría acelerar marginalmente la expiración de una request. Es el patrón estándar de deadlines (idéntico al de Uniswap et al.).

## Hallazgos previos resueltos en el refactor

Estos aspectos habrían generado hallazgos y se corrigieron en la adaptación a Modalidad 2 (2026-07-08):

- Doble sistema de pausa (herencia de `Pausable` OZ sin uso + flag propio `isPaused`) → eliminado; ahora se usa exclusivamente `Pausable` de OZ con `whenNotPaused` y `pause()/unpause()` bajo `PAUSER_ROLE`.
- `Ownable` (punto único de fallo) → sustituido por `AccessControl` con separación de privilegios.

## Reproducción

```bash
pip install slither-analyzer
cd accuro
slither . --filter-paths "node_modules"
```
