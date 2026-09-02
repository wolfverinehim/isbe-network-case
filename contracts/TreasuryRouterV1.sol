// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title TreasuryRouterV1
 * @dev Atomic routing contract para splits de stablecoin.
 * Garantiza "all or nothing": todos los transfers ocurren en 1 tx o ninguno.
 *
 * Conformidad ISBE Modalidad 2:
 * - RBAC via AccessControl (expone IAccessControl.hasRole)
 * - Pausabilidad via Pausable de OpenZeppelin (expone pause/unpause)
 * - PAUSER_ROLE debe incluir la direccion de gobernanza de ISBE
 */
contract TreasuryRouterV1 is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    /// @notice Rol que permite pausar/despausar el contrato.
    /// @dev Debe asignarse a la gobernanza de ISBE (requisito de homologacion).
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Rol que gestiona las allowlists de tokens y recipients.
    bytes32 public constant ALLOWLIST_ADMIN_ROLE =
        keccak256("ALLOWLIST_ADMIN_ROLE");

    struct RouteRequest {
        bytes32 groupId;
        address payer;
        address token;
        address reserveRecipient;
        address commissionRecipient;
        uint256 principalAmount;
        uint256 commissionAmount;
        uint256 deadline;
        uint256 nonce;
    }

    // Allowlisting
    mapping(address => bool) public allowlistedTokens;
    mapping(address => bool) public allowlistedRecipients;

    // Anti-replay: groupId ya procesado
    mapping(bytes32 => bool) public consumedGroups;

    // Nonce per payer
    mapping(address => uint256) public payerNonces;

    event FundingRouted(
        bytes32 indexed groupId,
        address indexed payer,
        address indexed token,
        uint256 principalAmount,
        uint256 commissionAmount,
        address reserveRecipient,
        address commissionRecipient,
        uint256 timestamp
    );

    event TokenAllowlisted(address indexed token);
    event TokenRemovedFromAllowlist(address indexed token);
    event RecipientAllowlisted(address indexed recipient);
    event RecipientRemovedFromAllowlist(address indexed recipient);

    /**
     * @param admin Direccion administradora (multisig Accuro).
     * @param isbeGovernance Direccion de gobernanza de ISBE (PAUSER_ROLE obligatorio).
     */
    constructor(address admin, address isbeGovernance) {
        require(admin != address(0), "Invalid admin");
        require(isbeGovernance != address(0), "Invalid ISBE governance");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ALLOWLIST_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(PAUSER_ROLE, isbeGovernance);
    }

    function routeFunding(
        RouteRequest calldata req
    ) external nonReentrant whenNotPaused {
        // Validaciones
        require(msg.sender == req.payer, "Caller must be payer");
        require(block.timestamp <= req.deadline, "Request expired");
        require(
            !consumedGroups[req.groupId],
            "Group already processed (replay)"
        );
        require(payerNonces[req.payer] == req.nonce, "Invalid nonce");
        require(req.token != address(0), "Invalid token");
        require(allowlistedTokens[req.token], "Token not allowlisted");
        require(
            allowlistedRecipients[req.reserveRecipient],
            "Reserve recipient not allowlisted"
        );
        require(
            allowlistedRecipients[req.commissionRecipient],
            "Commission recipient not allowlisted"
        );
        require(req.principalAmount > 0, "Principal must be > 0");
        require(req.commissionAmount > 0, "Commission must be > 0");
        require(req.payer != address(0), "Invalid payer");
        require(
            req.reserveRecipient != address(0),
            "Invalid reserve recipient"
        );
        require(
            req.commissionRecipient != address(0),
            "Invalid commission recipient"
        );
        require(
            req.reserveRecipient != req.commissionRecipient,
            "Reserve and commission recipients must differ"
        );

        // Mark consumed (anti-replay)
        consumedGroups[req.groupId] = true;
        payerNonces[req.payer]++;

        // Transfer principal
        IERC20(req.token).safeTransferFrom(
            req.payer,
            req.reserveRecipient,
            req.principalAmount
        );

        // Transfer commission
        IERC20(req.token).safeTransferFrom(
            req.payer,
            req.commissionRecipient,
            req.commissionAmount
        );

        // Emit event (used by bridge listener)
        emit FundingRouted(
            req.groupId,
            req.payer,
            req.token,
            req.principalAmount,
            req.commissionAmount,
            req.reserveRecipient,
            req.commissionRecipient,
            block.timestamp
        );
    }

    function canRoute(
        RouteRequest calldata req
    ) external view returns (bool, string memory) {
        if (paused()) return (false, "Routing paused");
        if (req.payer == address(0)) return (false, "Invalid payer");
        if (block.timestamp > req.deadline) return (false, "Request expired");
        if (consumedGroups[req.groupId])
            return (false, "Group already processed");
        if (payerNonces[req.payer] != req.nonce)
            return (false, "Invalid nonce");
        if (req.token == address(0)) return (false, "Invalid token");
        if (!allowlistedTokens[req.token])
            return (false, "Token not allowlisted");
        if (req.reserveRecipient == address(0))
            return (false, "Invalid reserve recipient");
        if (req.commissionRecipient == address(0))
            return (false, "Invalid commission recipient");
        if (req.reserveRecipient == req.commissionRecipient)
            return (false, "Reserve and commission recipients must differ");
        if (!allowlistedRecipients[req.reserveRecipient])
            return (false, "Reserve recipient not allowlisted");
        if (!allowlistedRecipients[req.commissionRecipient])
            return (false, "Commission recipient not allowlisted");
        if (req.principalAmount == 0) return (false, "Principal must be > 0");
        if (req.commissionAmount == 0) return (false, "Commission must be > 0");
        return (true, "Can route");
    }

    function allowlistToken(
        address token
    ) external onlyRole(ALLOWLIST_ADMIN_ROLE) whenNotPaused {
        require(token != address(0), "Invalid token");
        allowlistedTokens[token] = true;
        emit TokenAllowlisted(token);
    }

    function removeTokenFromAllowlist(
        address token
    ) external onlyRole(ALLOWLIST_ADMIN_ROLE) whenNotPaused {
        allowlistedTokens[token] = false;
        emit TokenRemovedFromAllowlist(token);
    }

    function allowlistRecipient(
        address recipient
    ) external onlyRole(ALLOWLIST_ADMIN_ROLE) whenNotPaused {
        require(recipient != address(0), "Invalid recipient");
        allowlistedRecipients[recipient] = true;
        emit RecipientAllowlisted(recipient);
    }

    function removeRecipientFromAllowlist(
        address recipient
    ) external onlyRole(ALLOWLIST_ADMIN_ROLE) whenNotPaused {
        allowlistedRecipients[recipient] = false;
        emit RecipientRemovedFromAllowlist(recipient);
    }

    /// @notice Pausa el routing. Requerido por ISBE (IPause.pause).
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Reactiva el routing. Requerido por ISBE (IPause.unpause).
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
