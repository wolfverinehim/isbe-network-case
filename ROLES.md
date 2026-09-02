# Documentación de roles y permisos (RBAC) — Accuro Routers

**Contratos:** `TreasuryRouterV1`, `SendRouterV1`, `TreasuryRouterV2`, `SendRouterV2`, `AccEURMock`
**Sistema:** OpenZeppelin `AccessControl` v4.9.6 (expone `IAccessControl`: `hasRole`, `getRoleAdmin`, `grantRole`, `revokeRole`, `renounceRole`)
**Fecha:** 2026-09-02 · Expediente Modalidad 2 ISBE

Los cuatro routers implementan el mismo esquema RBAC de tres roles. Se documenta una vez y aplica a todos; las funciones exclusivas de los V2 se detallan al final de la matriz. El token `AccEURMock` usa su propio esquema, documentado en su sección específica.

## Roles definidos

| Rol | Identificador (bytes32) | Titular previsto |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | `0x0000...0000` | Multisig de Accuro |
| `PAUSER_ROLE` | `keccak256("PAUSER_ROLE")` = `0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a` | **Gobernanza de ISBE** + multisig de Accuro |
| `ALLOWLIST_ADMIN_ROLE` | `keccak256("ALLOWLIST_ADMIN_ROLE")` = `0xe9ea3f660aa5a8eccd1bf9d16e6cdf3c1cf9a2b284b830f15bda4493942cb68f` | Cuenta operacional de Accuro |

### DEFAULT_ADMIN_ROLE

Administra el resto de roles (es el `roleAdmin` por defecto de todos). Permisos: `grantRole`, `revokeRole` sobre cualquier rol. No tiene permisos funcionales directos sobre el routing.

**Titular:** multisig de Accuro. No debe asignarse a cuentas EOA operacionales ni a servicios automatizados.

### PAUSER_ROLE — requisito de homologación ISBE

Permisos: `pause()` y `unpause()`.

Alcance de la pausa (lectura estricta del control 2 de la Modalidad 2: *"cambios de parámetros críticos, operaciones sobre fondos y todas las funciones que modifiquen estado crítico"*):

- **Bloqueado con el contrato pausado** — el routing (`routeFunding`, `routeFundingWithReferral`, `routeSend`), la liberación de rewards (`releaseReferralReward`, `releaseReferralEscrowToCommission`), la gestión de allowlists (alta **y baja** de tokens y recipients), la configuración crítica de V2 (`setReleaseExecutor`, `setReferralFallbackCommissionWallet`) y toda extracción de fondos (`emergencyWithdrawToken`, `rescueToken`, `rescueNative`). Es decir: **mientras ISBE mantenga la pausa, ninguna cuenta —incluido el `DEFAULT_ADMIN_ROLE`— puede mover fondos del contrato.**
- **Operativo con el contrato pausado** — las funciones `view` (`canRoute`, `canRouteSend`, `referralEscrowBalance`, `hasRole`, getters de allowlist) y la gestión de roles heredada de `AccessControl` (`grantRole`, `revokeRole`, `renounceRole`).

La excepción de la gestión de roles es deliberada: si una clave del `DEFAULT_ADMIN_ROLE` o del `ALLOWLIST_ADMIN_ROLE` queda comprometida, la remediación consiste precisamente en rotarla, y esa rotación debe ser posible con el contrato pausado. Toda concesión o revocación queda trazada por `RoleGranted`/`RoleRevoked`. Ninguna función de gestión de roles puede mover fondos ni alterar parámetros de negocio.

`canRoute`/`canRouteSend` devuelven `(false, "Routing paused")` mientras la pausa esté activa.

**Titulares:**

- **Dirección de gobernanza de ISBE** — asignación obligatoria en el constructor como condición *sine qua non* de homologación (Modalidad 2). ISBE la usará solo ante emergencias de red, fuerza mayor justificada u orden judicial. Su revocación posterior es técnicamente posible pero constituye una violación de los términos de uso de la red.
- **Multisig de Accuro** — pausa operacional propia (incidencias del caso de uso).

### ALLOWLIST_ADMIN_ROLE

Permisos: `allowlistToken`, `removeTokenFromAllowlist`, `allowlistRecipient`, `removeRecipientFromAllowlist`. Controla qué tokens ERC20 pueden enrutarse y qué direcciones pueden recibir fondos (en `SendRouterV1` la allowlist de recipients aplica solo al receptor de comisión; el recipient principal es dinámico por diseño del caso de uso P2P).

**Titular:** cuenta operacional de Accuro (puede ser distinta del multisig admin para agilidad operativa, aplicando mínimo privilegio).

## Matriz función → rol

| Función | Rol requerido | Otras protecciones |
|---|---|---|
| `routeFunding` / `routeSend` | Ninguno (público) | `whenNotPaused`, `nonReentrant`, `msg.sender == req.payer`, allowlists, anti-replay (groupId + nonce), deadline |
| `canRoute` / `canRouteSend` | Ninguno (view) | — |
| `allowlistToken` / `removeTokenFromAllowlist` | `ALLOWLIST_ADMIN_ROLE` | `whenNotPaused`, rechaza address(0) en alta |
| `allowlistRecipient` / `removeRecipientFromAllowlist` | `ALLOWLIST_ADMIN_ROLE` | `whenNotPaused`, rechaza address(0) en alta |
| `pause` / `unpause` | `PAUSER_ROLE` | `Pausable` OZ (no re-pausable/re-despausable) |
| `grantRole` / `revokeRole` | `DEFAULT_ADMIN_ROLE` | Operativo durante la pausa (remediación de claves) |
| `renounceRole` | El propio titular | Solo sobre uno mismo |

### Funciones adicionales de los routers V2

| Función | Contrato | Rol requerido | Otras protecciones |
|---|---|---|---|
| `routeFundingWithReferral` | `TreasuryRouterV2` | Ninguno (público) | `whenNotPaused`, `nonReentrant`, `msg.sender == req.payer`, allowlists (incluido el referral), anti-replay por `keccak256(groupId, payer)` + nonce, deadline |
| `releaseReferralReward` | `TreasuryRouterV2` | Ejecutor autorizado (`releaseExecutors`, **no** es un rol de `AccessControl`) | `whenNotPaused`, `nonReentrant`, `releaseId` anti-replay, saldo de escrow suficiente |
| `releaseReferralEscrowToCommission` | `TreasuryRouterV2` | Ejecutor autorizado (`releaseExecutors`) | `whenNotPaused`, `nonReentrant`, `releaseId` anti-replay, wallet de fallback configurada |
| `setReleaseExecutor` | `TreasuryRouterV2` | `DEFAULT_ADMIN_ROLE` | `whenNotPaused`, rechaza address(0), evento `ReleaseExecutorUpdated` |
| `setReferralFallbackCommissionWallet` | `TreasuryRouterV2` | `DEFAULT_ADMIN_ROLE` | `whenNotPaused`, rechaza address(0), evento `ReferralFallbackCommissionWalletUpdated` |
| `emergencyWithdrawToken` | `TreasuryRouterV2` | `DEFAULT_ADMIN_ROLE` | `whenNotPaused`, `nonReentrant`, comprueba saldo |
| `rescueToken` / `rescueNative` | `SendRouterV2` | `DEFAULT_ADMIN_ROLE` | `whenNotPaused`, `nonReentrant`, eventos `TokenRescued`/`NativeRescued` |

> **Pendiente de expediente:** `releaseExecutors` es un mapping de permisos gestionado por el `DEFAULT_ADMIN_ROLE`, al margen de `AccessControl`. Un ejecutor autorizado puede transferir escrow al beneficiario indicado. Evaluar convertirlo en un rol (`RELEASE_EXECUTOR_ROLE`) para que quede cubierto por `hasRole`/`grantRole` y por la trazabilidad estándar de `RoleGranted`/`RoleRevoked`.
>
> **Pendiente de expediente:** `emergencyWithdrawToken` puede extraer tokens que respaldan escrow de referral sin decrementar `_referralEscrowByRouteAndToken`, lo que dejaría la contabilidad interna por encima del saldo real. Acotar la función al excedente no comprometido o descontar el escrow explícitamente.

## Token AccEURMock

ERC20 de 6 decimales con cap inmutable, adaptado al mismo esquema de gobernanza.

| Rol | Titular previsto | Permisos |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Multisig de Accuro | Administra roles y `disableMinting` |
| `MINTER_ROLE` | Cuenta emisora de Accuro | `mint` hasta `maxSupply`, mientras `mintingDisabled == false` |
| `PAUSER_ROLE` | **Gobernanza de ISBE** + multisig de Accuro | `pause` / `unpause` |

Constructor: `constructor(string name, string symbol, address admin, address isbeGovernance, uint256 initialSupply, uint256 maxSupply)`. Revierte si `admin` o `isbeGovernance` son `address(0)`, si el cap es cero o si el supply inicial excede el cap. El `admin` recibe `DEFAULT_ADMIN_ROLE`, `MINTER_ROLE` y `PAUSER_ROLE`; la gobernanza de ISBE recibe únicamente `PAUSER_ROLE`.

Alcance de la pausa:

- **Bloqueado con el token pausado** — `transfer`, `approve`, `increaseAllowance`, `decreaseAllowance`, `transferFrom`, `mint`, `burn` y `disableMinting`.
- **Operativo con el token pausado** — funciones `view` (`balanceOf`, `allowance`, `totalSupply`, `hasRole`) y la gestión de roles (`grantRole`, `revokeRole`, `renounceRole`), por la misma excepción de remediación de claves aplicada a los routers.

No existe `owner` ni transferencia de propiedad: el control es exclusivamente por roles, con trazabilidad `RoleGranted`/`RoleRevoked`. `disableMinting` es irreversible y emite `MintingDisabled`.

## Asignación inicial (constructor)

```solidity
constructor(address admin, address isbeGovernance)
```

| Cuenta | Roles concedidos |
|---|---|
| `admin` | `DEFAULT_ADMIN_ROLE`, `ALLOWLIST_ADMIN_ROLE`, `PAUSER_ROLE` |
| `isbeGovernance` | `PAUSER_ROLE` |

El constructor revierte si cualquiera de las dos direcciones es `address(0)`. El script `scripts/deploy.ts` verifica post-despliegue que `hasRole(PAUSER_ROLE, isbeGovernance) == true` y aborta en caso contrario.

## Rotación y revocación de roles

- **Conceder:** `grantRole(ROLE, cuenta)` desde el `DEFAULT_ADMIN_ROLE`.
- **Revocar:** `revokeRole(ROLE, cuenta)` desde el `DEFAULT_ADMIN_ROLE`.
- **Rotación segura:** conceder el rol a la cuenta nueva **antes** de revocar a la antigua (sin ventana sin titular).
- **Renuncia:** cualquier titular puede ejecutar `renounceRole` sobre sí mismo.
- **Restricción de gobernanza:** el `PAUSER_ROLE` de la dirección de gobernanza de ISBE **no debe revocarse** (violación de los términos de uso de la red; ISBE se reserva el filtrado de address a nivel de nodo).
- **Riesgo a evitar:** revocar el último `DEFAULT_ADMIN_ROLE` deja el contrato sin administración de roles de forma permanente.

## Trazabilidad (eventos)

- `RoleGranted(role, account, sender)` / `RoleRevoked(role, account, sender)` — heredados de `AccessControl`, emitidos en toda concesión/revocación (incluidas las del constructor).
- `Paused(account)` / `Unpaused(account)` — heredados de `Pausable`, identifican qué cuenta pausó/reanudó.
- `TokenAllowlisted`, `TokenRemovedFromAllowlist`, `RecipientAllowlisted`, `RecipientRemovedFromAllowlist` — cambios de configuración de allowlists.
- `FundingRouted` / `SendRouted` — cada operación de negocio, con todos los parámetros y timestamp.

## Principio de mínimo privilegio

- El routing es público: no requiere rol, la seguridad recae en las validaciones (payer = caller, allowlists, anti-replay).
- La gobernanza de ISBE recibe **exclusivamente** `PAUSER_ROLE`: no puede administrar roles ni allowlists.
- La gestión de allowlists está separada de la administración de roles, permitiendo delegar operación sin ceder el control del contrato.
- No existen funciones ocultas de administración ni mecanismos de upgrade en el contrato.

## Verificación (tests)

Suites en `test/` (92 tests): asignación de roles en despliegue, pause/unpause por la gobernanza ISBE, rechazo de cuentas sin rol en cada función protegida, rotación (grant/revoke), bloqueo de operaciones en pausa y semántica completa del token ERC20.

Cobertura específica del alcance de la pausa — bloque *"Pausabilidad de funciones administrativas (Modalidad 2)"* en las suites V1 y los tests equivalentes en las V2:

- Con el contrato pausado por la gobernanza de ISBE, revierten con `Pausable: paused`: alta y baja de tokens, alta y baja de recipients, `setReleaseExecutor`, `setReferralFallbackCommissionWallet`, `emergencyWithdrawToken`, `rescueToken` y `rescueNative`.
- Tras `unpause()`, la gestión de allowlists vuelve a operar y emite sus eventos.
- Con el contrato pausado, `grantRole` sigue operativo y emite `RoleGranted` (excepción documentada para la remediación de claves).
