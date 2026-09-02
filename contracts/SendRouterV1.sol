// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title SendRouterV1
 * @dev Router atomico para send P2P con recipient dinamico.
 * Separa principal (recipient) y comision (commissionRecipient) en una sola tx.
 *
 * Conformidad ISBE Modalidad 2:
 * - RBAC via AccessControl (expone IAccessControl.hasRole)
 * - Pausabilidad via Pausable de OpenZeppelin (expone pause/unpause)
 * - PAUSER_ROLE debe incluir la direccion de gobernanza de ISBE
 */
contract SendRouterV1 is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    /// @notice Rol que permite pausar/despausar el contrato.
    /// @dev Debe asignarse a la gobernanza de ISBE (requisito de homologacion).
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Rol que gestiona las allowlists de tokens y recipients.
    bytes32 public constant ALLOWLIST_ADMIN_ROLE =
        keccak256("ALLOWLIST_ADMIN_ROLE");

    struct SendRequest {
        bytes32 groupId;
        address payer;
        address token;
        address recipient;
        address commissionRecipient;
        uint256 amount;
        uint256 commissionAmount;
        uint256 deadline;
        uint256 nonce;
    }

    mapping(address => bool) public allowlistedTokens;
    mapping(address => bool) public allowlistedRecipients;

    mapping(bytes32 => bool) public consumedGroups;
    mapping(address => uint256) public payerNonces;

    event SendRouted(
        bytes32 indexed groupId,
        address indexed payer,
        address indexed token,
        address recipient,
        uint256 amount,
        uint256 commissionAmount,
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

    function routeSend(
        SendRequest calldata req
    ) external nonReentrant whenNotPaused {
        require(msg.sender == req.payer, "Caller must be payer");
        require(block.timestamp <= req.deadline, "Request expired");
        require(
            !consumedGroups[req.groupId],
            "Group already processed (replay)"
        );
        require(payerNonces[req.payer] == req.nonce, "Invalid nonce");
        require(req.payer != address(0), "Invalid payer");
        require(req.token != address(0), "Invalid token");
        require(allowlistedTokens[req.token], "Token not allowlisted");
        require(
            req.commissionRecipient != address(0),
            "Invalid commission recipient"
        );
        require(
            allowlistedRecipients[req.commissionRecipient],
            "Commission recipient not allowlisted"
        );
        require(req.amount > 0, "Amount must be > 0");
        require(req.commissionAmount > 0, "Commission must be > 0");
        require(req.recipient != address(0), "Invalid recipient");
        require(
            req.recipient != req.commissionRecipient,
            "Recipient cannot be commission recipient"
        );

        consumedGroups[req.groupId] = true;
        payerNonces[req.payer]++;

        IERC20(req.token).safeTransferFrom(
            req.payer,
            req.recipient,
            req.amount
        );
        IERC20(req.token).safeTransferFrom(
            req.payer,
            req.commissionRecipient,
            req.commissionAmount
        );

        emit SendRouted(
            req.groupId,
            req.payer,
            req.token,
            req.recipient,
            req.amount,
            req.commissionAmount,
            req.commissionRecipient,
            block.timestamp
        );
    }

    function canRouteSend(
        SendRequest calldata req
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
        if (req.commissionRecipient == address(0))
            return (false, "Invalid commission recipient");
        if (!allowlistedRecipients[req.commissionRecipient])
            return (false, "Commission recipient not allowlisted");
        if (req.amount == 0) return (false, "Amount must be > 0");
        if (req.commissionAmount == 0) return (false, "Commission must be > 0");
        if (req.recipient == address(0)) return (false, "Invalid recipient");
        if (req.recipient == req.commissionRecipient)
            return (false, "Recipient cannot be commission recipient");
        return (true, "Can route send");
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

    /// @notice Pausa el routing
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Reactiva el routing
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
