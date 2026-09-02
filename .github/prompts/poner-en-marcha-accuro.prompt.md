---
name: "Poner en marcha Accuro ISBE"
description: "Revisa el proyecto Accuro, su documentación y configuración, y guía o ejecuta su puesta en marcha de forma segura."
argument-hint: "Indica el entorno objetivo, por ejemplo local, ISBE dev o solo validación"
agent: "agent"
---

Revisa este repositorio Accuro y ayúdame a ponerlo en marcha en el entorno indicado: `${input:entorno:local}`.

## Objetivo

Trabaja como ingeniero senior de Solidity/Hardhat y operador cuidadoso de redes Besu/QBFT. Determina el camino mínimo para pasar del estado actual a una ejecución verificable, usando la documentación del repositorio como fuente principal.

## Procedimiento

1. Lee primero [README.md](../../README.md), [hardhat.config.ts](../../hardhat.config.ts), `package.json`, los scripts relevantes de `scripts/` y las pruebas de `test/`. Consulta también [ROLES.md](../../ROLES.md), [ANALISIS_MODALIDAD2.md](../../ANALISIS_MODALIDAD2.md) y [SLITHER_REPORT.md](../../SLITHER_REPORT.md) cuando afecten a la decisión.
2. Comprueba el estado del workspace y las herramientas disponibles: Node.js, npm, dependencias instaladas, configuración de Hardhat y existencia de `.env`. No muestres ni registres claves privadas, tokens ni otros secretos.
3. Identifica contradicciones entre documentación y código. En particular, verifica los nombres de las variables de clave privada, RPC, `CHAIN_ID` y gobernanza ISBE antes de ejecutar un despliegue.
4. Ejecuta primero las comprobaciones locales y reproducibles que correspondan:
   - `npm install` solo si faltan dependencias y el usuario ha autorizado instalar paquetes.
   - `npx hardhat compile`
   - `npx hardhat test`
   - `npx hardhat coverage` solo si aporta información necesaria y el tiempo/coste es razonable.
5. Si el objetivo es una red local, explica cómo iniciar la red o nodo disponible y ejecuta únicamente lo que pueda hacerse sin secretos ni fondos reales. Si el objetivo es ISBE dev o pre, comprueba que el RPC responde, que el `chainId` coincide y que la cuenta tiene saldo para gas antes de desplegar o interactuar. En pre usa la red Hardhat `pre` y los scripts `allowlist.ts`, `configure-v2.ts`, `fund-gas.ts` y `smoke-pre-v2.ts` según corresponda.
6. No despliegues ni envíes transacciones en una red real o compartida sin pedir una confirmación explícita justo antes de hacerlo. Antes de esa confirmación, prepara una lista concreta de variables y acciones que se usarán, ocultando los valores sensibles.
7. Tras cualquier despliegue autorizado, verifica los contratos, el `PAUSER_ROLE` de la gobernanza ISBE, las allowlists configuradas y el registro en `deployments/`. Ejecuta `scripts/interact.ts` o `scripts/smoke-pre-v2.ts` solo si sus variables necesarias están completas y la operación es segura. No registres URLs autenticadas, mnemónicos ni claves privadas en documentación o JSON versionados.
8. Si una comprobación falla, localiza la causa en el código o la documentación, corrige solo lo necesario si la solución es inequívoca y vuelve a ejecutar la comprobación enfocada. No edites contratos ni cambies parámetros de seguridad para silenciar un fallo.

## Formato de respuesta

Termina con estas secciones:

### Estado

Indica si el proyecto está listo, bloqueado o listo solo para una fase concreta.

### Comprobaciones

Lista cada comando ejecutado con resultado breve. Distingue entre comprobaciones ejecutadas, omitidas y pendientes.

### Problemas y acciones

Describe los bloqueos con archivo o variable relacionada y proporciona el siguiente comando o cambio necesario. Señala expresamente cualquier discrepancia entre README y código.

### Siguiente paso seguro

Da una única acción inmediata. Si requiere red, clave privada, fondos o confirmación del usuario, dilo claramente y no la ejecutes todavía.

No afirmes que el proyecto está desplegado o funcionando si no existe evidencia de una ejecución exitosa. Mantén la respuesta en español y sé conciso.