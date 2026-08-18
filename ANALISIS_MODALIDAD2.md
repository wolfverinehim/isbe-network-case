# Análisis de conformidad — Accuro → ISBE Modalidad 2 (Contrato propio homologado)

**Fecha:** 2026-07-08
**Contratos analizados:** `TreasuryRouterV1.sol`, `SendRouterV1.sol`, `AccEURMock.sol`
**Referencia:** [Modalidad 2](https://docs.redisbe.com/documentation/smart-contracts/modalidades/contrato-propio) · [Desarrollo de Contratos Custom](https://docs.redisbe.com/documentation/smart-contracts/contratos-custom)

---

> **Actualización 2026-07-08:** Confirmado por el equipo que, pese a lo que indica la documentación pública, en Modalidad 2 el contrato **se despliega directamente** (sin Diamond Proxy de ISBE). Por tanto el unstructured storage y el patrón initializer **no aplican**; los requisitos bloqueantes reales son RBAC (`hasRole`) y pausabilidad (`pause/unpause` con `PAUSER_ROLE` para la gobernanza de ISBE). Ambos ya se han implementado en los dos routers (AccessControl + Pausable OZ, constructor con `admin` + `isbeGovernance`).

## Resumen ejecutivo

Los routers de Accuro tienen una lógica de negocio sólida (anti-replay, nonces, deadlines, allowlists, SafeERC20, ReentrancyGuard), pero incumplían los requisitos de gobernanza de la Modalidad 2: RBAC con `PAUSER_ROLE` para ISBE y pausabilidad estándar (`IPause.pause/unpause`) — **ya corregidos**. Queda pendiente: **suite de tests** (vacía), análisis estático y build reproducible.

| Control obligatorio | TreasuryRouterV1 | SendRouterV1 | AccEURMock |
|---|---|---|---|
| 1. RBAC (`onlyRole`, `hasRole`) | ❌ Ownable | ❌ Ownable | ❌ owner manual |
| 1b. `PAUSER_ROLE` → gobernanza ISBE | ❌ | ❌ | ❌ |
| 2. Pausabilidad (`whenNotPaused` + `IPause`) | ❌ sistema propio | ❌ sistema propio | ⚠️ parcial |
| 3. Unstructured storage | ❌ estructurado | ❌ estructurado | ❌ estructurado |
| 4. Eventos de trazabilidad | ✅ buenos | ✅ buenos | ✅ buenos |
| 5. Tests + análisis estático | ❌ carpeta `test/` vacía | ❌ | ❌ |
| 6. Build reproducible | ❌ inconsistente | ❌ | ❌ |

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

- `hardhat.config.ts` fija solc `0.8.28` sin settings de optimizer, pero los contratos usan `pragma ^0.8.20` y el deploy real (`scripts/deploy_acceur_isbe.py`) compila con **py-solc-x**, un toolchain distinto → no hay equivalencia bytecode↔fuente garantizada.
- Falta `metadata.json`, flags exactos y política de versión.

**Adaptación:** unificar en Hardhat: fijar `pragma solidity 0.8.28` (exacto), optimizer explícito (p. ej. enabled/200), generar `metadata.json`, y reescribir el despliegue como scripts Hardhat documentados (ISBE orquesta el despliegue final, pero exige los scripts en el expediente).

### 8. AccEURMock — decisión de alcance

Es un mock de testing (así lo documenta `info/ACCEUR_ISBE_DEPLOY.md`). Dos opciones:

- **Recomendada:** no homologarlo. Usar la **plantilla ERC20 de ISBE** (Modalidad 1, sin proceso de conformidad) como token de pruebas/producción. Menos coste y plazo cero.
- Si Accuro exige token propio: requiere el mismo refactor completo (RBAC, storage, `PAUSER_ROLE`) y, si representa dinero electrónico/instrumento regulado, podría exigir **Nivel A** (auditoría externa) y encajar mejor en ERC3643.

---

## Plan de adaptación propuesto

| Fase | Trabajo | Estado |
|---|---|---|
| 1 | Decisión de diseño: routers separados (petición del cliente); destino de AccEURMock pendiente | ✅ / ⏳ |
| 2 | Refactor Solidity: RBAC (`onlyRole`, `PAUSER_ROLE` → gobernanza ISBE), pausabilidad OZ (`whenNotPaused`, `pause/unpause`) | ✅ Hecho (2026-07-08) |
| 3 | Suite de tests (unit + integración, cobertura rutas críticas) + Slither sin críticos | ⏳ Pendiente |
| 4 | Build reproducible: pragma exacto, optimizer, metadata.json, lockfile, scripts Hardhat de despliegue | ⏳ Pendiente |
| 5 | Documentación: roles/permisos, funciones, casos de prueba | ⏳ Pendiente |
| 6 | Solicitud de conformidad a ISBE (objetivo: **Nivel C**, 2–4 semanas) | ⏳ Pendiente |

**Nota regulatoria:** los routers mueven stablecoins con comisión. Si ISBE lo clasifica como servicio sobre instrumento regulado, el nivel exigido podría subir a B/A. Conviene confirmarlo con ISBE al registrar la solicitud. (Esto no es asesoramiento legal.)

---

## Checklist de auto-validación ISBE (estado actual)

- [ ] Código fuente completo con commit/branch — *repo existe, falta fijar versión*
- [x] ~~Unstructured storage~~ — **NO APLICA** (despliegue directo confirmado)
- [x] RBAC con `PAUSER_ROLE` incluido — **SÍ** (falta documentación formal de roles)
- [x] Eventos en acciones sensibles — **SÍ** (RoleGranted/Paused/Unpaused vía OZ)
- [ ] Tests con reporte de cobertura — **NO**
- [ ] Análisis estático sin críticos — **NO**
- [ ] metadata.json + flags de build reproducible — **NO**
- [ ] Scripts de despliegue completos — **NO** (script Python inconsistente con toolchain)
