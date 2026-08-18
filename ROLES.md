# Documentación de roles y permisos (RBAC) — Accuro Routers

**Contratos:** `TreasuryRouterV1`, `SendRouterV1`
**Sistema:** OpenZeppelin `AccessControl` v4.9.6 (expone `IAccessControl`: `hasRole`, `getRoleAdmin`, `grantRole`, `revokeRole`, `renounceRole`)
**Fecha:** 2026-07-08 · Expediente Modalidad 2 ISBE

Ambos routers implementan el mismo esquema RBAC. Se documenta una vez y aplica a los dos.

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

Permisos: `pause()` y `unpause()`. Con el contrato pausado, `routeFunding`/`routeSend` revierten (`whenNotPaused`) y `canRoute`/`canRouteSend` devuelven `(false, "Routing paused")`. Las funciones de administración y consulta permanecen operativas para permitir remediación durante una pausa.

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
| `allowlistToken` / `removeTokenFromAllowlist` | `ALLOWLIST_ADMIN_ROLE` | Rechaza address(0) en alta |
| `allowlistRecipient` / `removeRecipientFromAllowlist` | `ALLOWLIST_ADMIN_ROLE` | Rechaza address(0) en alta |
| `pause` / `unpause` | `PAUSER_ROLE` | `Pausable` OZ (no re-pausable/re-despausable) |
| `grantRole` / `revokeRole` | `DEFAULT_ADMIN_ROLE` | — |
| `renounceRole` | El propio titular | Solo sobre uno mismo |

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

Suite en `test/TreasuryRouterV1.ts` y `test/SendRouterV1.ts` (53 tests): asignación de roles en despliegue, pause/unpause por la gobernanza ISBE, rechazo de cuentas sin rol en cada función protegida, rotación (grant/revoke) y bloqueo de operaciones en pausa.
