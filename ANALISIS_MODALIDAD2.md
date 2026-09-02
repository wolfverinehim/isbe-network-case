# Análisis de conformidad — Accuro → ISBE Modalidad 2 (Contrato propio homologado)

**Fecha:** 2026-09-02
**Contratos analizados:** `TreasuryRouterV1.sol`, `SendRouterV1.sol`, `TreasuryRouterV2.sol`, `SendRouterV2.sol`, `AccEURMock.sol`
**Referencia:** [Modalidad 2](https://docs.redisbe.com/documentation/smart-contracts/modalidades/contrato-propio) · [Desarrollo de Contratos Custom](https://docs.redisbe.com/documentation/smart-contracts/contratos-custom)

---

> **Actualización 2026-07-08:** Confirmado por el equipo que, pese a lo que indica la documentación pública, en Modalidad 2 el contrato **se despliega directamente** (sin Diamond Proxy de ISBE). Por tanto el unstructured storage y el patrón initializer **no aplican**; los requisitos bloqueantes reales son RBAC (`hasRole`) y pausabilidad (`pause/unpause` con `PAUSER_ROLE` para la gobernanza de ISBE).
>
> **Actualización 2026-09-02:** Cerrados los bloqueantes restantes. `AccEURMock` migrado a `AccessControl` + `Pausable` con `PAUSER_ROLE` para ISBE; suite de tests completa (92 tests); Slither reejecutado sin críticos abiertos; build unificado en Hardhat con pragma exacto `0.8.28` en los cinco contratos y retirada del flujo Python (py-solc-x).

## Resumen ejecutivo

Los routers y el token de Accuro combinan una lógica de negocio sólida (anti-replay, nonces, deadlines, allowlists, SafeERC20, ReentrancyGuard) con los requisitos de gobernanza de la Modalidad 2: RBAC con `PAUSER_ROLE` para ISBE y pausabilidad estándar. Los controles obligatorios están cubiertos; queda únicamente la presentación formal del expediente a ISBE.

| Control obligatorio | Routers V1 | Routers V2 | AccEURMock |
|---|---|---|---|
| 1. RBAC (`onlyRole`, `hasRole`) | ✅ AccessControl | ✅ AccessControl | ✅ AccessControl |
| 1b. `PAUSER_ROLE` → gobernanza ISBE | ✅ | ✅ | ✅ |
| 2. Pausabilidad (`whenNotPaused` + `IPause`) | ✅ | ✅ | ✅ |
| 3. Unstructured storage | — no aplica | — no aplica | — no aplica |
| 4. Eventos de trazabilidad | ✅ | ✅ | ✅ |
| 5. Tests + análisis estático | ✅ 92 tests · Slither sin críticos | ✅ | ✅ |
| 6. Build reproducible | ✅ solc 0.8.28 exacto | ✅ | ✅ |

---

## Hallazgos detallados

### 1. Control de acceso (RBAC) — BLOQUEANTE

- Los tres contratos usan `Ownable` / owner manual en lugar de `AccessControl`. No existe `hasRole` (interfaz `IAccessControl` exigida explícitamente por la Modalidad 2) ni el modificador `onlyRole`.
- No hay `PAUSER_ROLE`, por lo que es imposible asignar la dirección de gobernanza de ISBE — **condición sine qua non para la homologación** (el contrato `0x15Be` valida esta asignación ejecutando pause/unpause durante la validación).
- No hay documentación de roles ni mecanismos de rotación/revocación conformes.

**Adaptación:** sustituir `Ownable` por el sistema de roles de ISBE con `onlyRole`. Roles propuestos: `DEFAULT_ADMIN_ROLE` (multisig Accuro), `ALLOWLIST_ADMIN_ROLE` (gestión de tokens/recipients), `PAUSER_ROLE` (gobernanza ISBE + operación Accuro).

### 2. Pausabilidad — BLOQUEANTE

- Ambos routers **heredan `Pausable` de OpenZeppelin pero no lo usan**: implementan un flag propio `isPaused` con el modificador custom `notPaused` y la función `pauseRouting(bool) onlyOwner`.
- No exponen `pause()` / `unpause()` (interfaz `IPause` exigida), y `_pause/_unpause` de OZ son internal, así que ISBE no puede pausar el contrato. La validación automática de `0x15Be` fallaría.
- Coexisten dos estados de pausa (`paused()` de OZ e `isPaused`), lo que además es un hallazgo típico de análisis estático (código muerto/ambigüedad).
- `AccEURMock` sí expone `pause()/unpause()` pero solo con owner manual, sin `PAUSER_ROLE`.

**Adaptación:** eliminar `isPaused`/`notPaused`/`pauseRouting`, usar el sistema de pausas de ISBE con `whenNotPaused` en `routeFunding`, `routeSend` y funciones de allowlist, y exponer `pause()/unpause()` protegidas por `PAUSER_ROLE`.

### 3. Integridad del storage — NO APLICA (despliegue directo confirmado)

*Sección conservada como referencia histórica; la doc pública indica Diamond Proxy pero el despliegue real es directo.*

### 3-bis. Integridad del storage — análisis original

- Todo el estado se declara como variables de estado normales (slots secuenciales 0..n): `allowlistedTokens`, `allowlistedRecipients`, `consumedGroups`, `payerNonces`, `isPaused`.
- Las bases heredadas de OZ 4.9.6 (`Ownable`, `ReentrancyGuard`, `Pausable`) también usan storage estructurado.
- ISBE despliega la lógica tras un **Diamond Proxy**: el storage estructurado colisionará con el del diamond y otras facetas. El unstructured storage es **obligatorio**.
- Consecuencia adicional: los `constructor` no se ejecutan tras proxy → hay que migrar a patrón `initialize()`.

**Adaptación:** mover todo el estado a un struct en slot único (`keccak256("accuro.treasury.router.storage")` / `keccak256("accuro.send.router.storage")`), incluir el guard de reentrancy dentro del struct (o usar variante namespaced), y reemplazar constructores por inicializadores idempotentes. Documentar slots y estructura (entregable del expediente).

### 4. Selectores únicos — NO APLICA (cada router se despliega en su propia dirección)

- `TreasuryRouterV1` y `SendRouterV1` comparten selectores idénticos: `allowlistToken`, `removeTokenFromAllowlist`, `allowlistRecipient`, `removeRecipientFromAllowlist`, `pauseRouting`, más `paused()`/`owner()` heredados. Si ambos se integran como facetas del mismo caso de uso, hay **colisión de selectores**.

**Adaptación (decisión de diseño):** o bien (a) fusionar ambos routers en un único contrato `AccuroRouter` (la lógica es ~90% idéntica: `routeSend` es `routeFunding` con recipient dinámico), o bien (b) mantenerlos como dos casos de uso separados con allowlists diferenciadas. Recomendación: **(a) fusionar** — reduce superficie de auditoría, un solo expediente, un solo storage slot.

### 5. Eventos de trazabilidad — OK con mejoras menores

- `FundingRouted` / `SendRouted` y los eventos de allowlist están bien diseñados (indexed correctos, timestamp).
- Al migrar a RBAC habrá que emitir/heredar eventos de asignación y revocación de roles y los eventos `Paused/Unpaused` estándar.

### 6. Tests y análisis estático — BLOQUEANTE (Nivel C exige ambos)

- La carpeta `test/` está **vacía**. Se requiere suite unitaria + integración con cobertura de rutas críticas: replay, nonce inválido, deadline, allowlists, pausado, atomicidad de los dos transfers, control de acceso por rol.
- No hay reporte de Slither/Mythril. Hallazgos previsibles a corregir: doble sistema de pausa, herencia de `Pausable` sin uso, falta de `_disableInitializers`.

### 7. Build reproducible — BLOQUEANTE

- `hardhat.config.ts` fijaba solc `0.8.28` sin settings de optimizer, los contratos usaban `pragma ^0.8.20` y el deploy real compilaba con **py-solc-x**, un toolchain distinto → no había equivalencia bytecode↔fuente garantizada. **Resuelto (2026-09-02):** pragma exacto `0.8.28` en los cinco contratos, optimizer explícito y despliegue unificado en scripts Hardhat; el flujo Python se ha retirado.
- Falta `metadata.json`, flags exactos y política de versión.

**Adaptación:** unificar en Hardhat: fijar `pragma solidity 0.8.28` (exacto), optimizer explícito (p. ej. enabled/200), generar `metadata.json`, y reescribir el despliegue como scripts Hardhat documentados (ISBE orquesta el despliegue final, pero exige los scripts en el expediente).

### 8. AccEURMock — adaptado (2026-09-02)

Inicialmente se documentó como mock de testing y se recomendó no homologarlo. Finalmente se ha adaptado al mismo estándar que los routers:

- `AccessControl` con `DEFAULT_ADMIN_ROLE`, `MINTER_ROLE` y `PAUSER_ROLE`; eliminado el `owner` manual y la transferencia de propiedad en dos pasos.
- `Pausable` de OZ con `pause()/unpause()` bajo `PAUSER_ROLE`, asignado a la gobernanza de ISBE en el constructor.
- Pausa aplicada también a parámetros críticos (`disableMinting`) además de transferencias, allowances, `mint` y `burn`.
- Suite propia de tests y despliegue vía `scripts/deploy-token.ts` (mismo toolchain que los routers).

**Nota regulatoria:** si el token llegara a representar dinero electrónico o un instrumento regulado, podría exigirse **Nivel A** (auditoría externa) y encajar mejor en ERC3643.

---

## Plan de adaptación propuesto

| Fase | Trabajo | Estado |
|---|---|---|
| 1 | Decisión de diseño: routers separados (petición del cliente); `AccEURMock` adaptado en lugar de descartado | ✅ |
| 2 | Refactor Solidity: RBAC (`onlyRole`, `PAUSER_ROLE` → gobernanza ISBE), pausabilidad OZ (`whenNotPaused`, `pause/unpause`) | ✅ Hecho (2026-07-08 routers · 2026-09-02 token) |
| 3 | Suite de tests (unit + integración, cobertura rutas críticas) + Slither sin críticos | ✅ 92 tests · Slither 22 hallazgos, 0 críticos abiertos |
| 4 | Build reproducible: pragma exacto, optimizer, lockfile, scripts Hardhat de despliegue | ✅ solc 0.8.28 exacto · flujo Python retirado |
| 5 | Documentación: roles/permisos, funciones, casos de prueba | ✅ `ROLES.md` · `SLITHER_REPORT.md` · `info/ACCEUR_ISBE_DEPLOY.md` |
| 6 | Solicitud de conformidad a ISBE (objetivo: **Nivel C**, 2–4 semanas) | ⏳ Pendiente |

**Nota regulatoria:** los routers mueven stablecoins con comisión. Si ISBE lo clasifica como servicio sobre instrumento regulado, el nivel exigido podría subir a B/A. Conviene confirmarlo con ISBE al registrar la solicitud. (Esto no es asesoramiento legal.)

---

## Checklist de auto-validación ISBE (estado actual)

- [x] Código fuente completo con commit/branch — repo publicado, rama `master`
- [x] ~~Unstructured storage~~ — **NO APLICA** (despliegue directo confirmado)
- [x] RBAC con `PAUSER_ROLE` incluido — **SÍ**, documentado en `ROLES.md`
- [x] Eventos en acciones sensibles — **SÍ** (RoleGranted/Paused/Unpaused vía OZ)
- [x] Tests — **SÍ**, 92 tests cubriendo roles, pausa, anti-replay, atomicidad y ERC20
- [x] Análisis estático sin críticos — **SÍ** (`SLITHER_REPORT.md`, 2026-09-02)
- [x] Flags de build reproducible — **SÍ** (solc 0.8.28 exacto, optimizer 200, `bytecodeHash: ipfs`)
- [x] Scripts de despliegue completos — **SÍ** (`scripts/deploy.ts`, `deploy-v2.ts`, `deploy-token.ts`)
- [ ] Solicitud presentada a ISBE — **PENDIENTE**
