// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title TreasuryRouterV2
 * @dev Router atomico con split opcional de referral y escrow onchain para rewards.
 *
 * Seguridad:
 * - routeFunding* solo puede mover fondos del payer (msg.sender == payer).
 * - nonce por payer y anti-replay por (groupId,payer).
 * - allowlist de token y recipients de funding.
 * - release de rewards restringido a executors autorizados por owner.
 */
contract TreasuryRouterV2 is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant ALLOWLIST_ADMIN_ROLE = keccak256("ALLOWLIST_ADMIN_ROLE");

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

    struct RouteRequestWithReferral {
        bytes32 groupId;
        address payer;
        address token;
        address reserveRecipient;
        address commissionRecipient;
        address referralRecipient;
        uint256 principalAmount;
        uint256 commissionAmount;
        uint256 referralAmount;
        uint256 deadline;
        uint256 nonce;
    }

    mapping(address => bool) public allowlistedTokens;
    mapping(address => bool) public allowlistedRecipients;
    mapping(address => bool) public releaseExecutors;

    // Wallet de comisiones para recuperar escrow no liberado a beneficiario final.
    address public referralFallbackCommissionWallet;

    // routeKey = keccak256(groupId, payer)
    mapping(bytes32 => bool) public consumedRouteKeys;

    // releaseId anti-replay (global + por tipo para trazabilidad)
    mapping(bytes32 => bool) public consumedReleaseIds;
    mapping(bytes32 => bool) public consumedReleases;
    mapping(bytes32 => bool) public consumedCommissionReleases;

    // Escrow onchain por routeKey/token cuando referralRecipient == address(this)
    mapping(bytes32 => mapping(address => uint256)) private _referralEscrowByRouteAndToken;

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

    event FundingRoutedWithReferral(
        bytes32 indexed groupId,
        address indexed payer,
        address indexed token,
        uint256 principalAmount,
        uint256 commissionAmount,
        uint256 referralAmount,
        address reserveRecipient,
        address commissionRecipient,
        address referralRecipient,
        uint256 timestamp
    );

    event ReferralEscrowFunded(
        bytes32 indexed routeKey,
        bytes32 indexed groupId,
        address indexed token,
        uint256 amount,
        uint256 newBalance
    );

    event ReferralRewardReleased(
        bytes32 indexed releaseId,
        bytes32 indexed routeKey,
        address indexed beneficiary,
        address token,
        uint256 amount
    );

    event ReferralCommissionReleaseExecuted(
        bytes32 indexed releaseId,
        bytes32 indexed routeKey,
        address indexed commissionWallet,
        address token,
        uint256 amount
    );

    event ReferralFallbackCommissionWalletUpdated(address indexed wallet);

    event TokenAllowlisted(address indexed token);
    event TokenRemovedFromAllowlist(address indexed token);
    event RecipientAllowlisted(address indexed recipient);
    event RecipientRemovedFromAllowlist(address indexed recipient);
    event ReleaseExecutorUpdated(address indexed executor, bool enabled);
    event RoutingPaused(bool paused);

    modifier onlyReleaseExecutor() {
        require(releaseExecutors[msg.sender], "Caller is not release executor");
        _;
    }

    constructor(address admin, address isbeGovernance) {
        require(admin != address(0), "Invalid admin");
        require(isbeGovernance != address(0), "Invalid ISBE governance");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ALLOWLIST_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(PAUSER_ROLE, isbeGovernance);
    }

    function routeFunding(RouteRequest calldata req) external nonReentrant whenNotPaused {
        bytes32 routeKey = _validateAndConsumeBaseRoute(
            req.groupId,
            req.payer,
            req.token,
            req.reserveRecipient,
            req.commissionRecipient,
            req.principalAmount,
            req.commissionAmount,
            req.deadline,
            req.nonce
        );

        IERC20(req.token).safeTransferFrom(req.payer, req.reserveRecipient, req.principalAmount);
        IERC20(req.token).safeTransferFrom(req.payer, req.commissionRecipient, req.commissionAmount);

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

        // silence unused local variable warning in some analyzers
        routeKey;
    }

    function routeFundingWithReferral(RouteRequestWithReferral calldata req) external nonReentrant whenNotPaused {
        bytes32 routeKey = _validateAndConsumeBaseRoute(
            req.groupId,
            req.payer,
            req.token,
            req.reserveRecipient,
            req.commissionRecipient,
            req.principalAmount,
            req.commissionAmount,
            req.deadline,
            req.nonce
        );

        _validateReferralSplit(
            req.referralRecipient,
            req.referralAmount,
            req.reserveRecipient,
            req.commissionRecipient
        );

        IERC20(req.token).safeTransferFrom(req.payer, req.reserveRecipient, req.principalAmount);
        IERC20(req.token).safeTransferFrom(req.payer, req.commissionRecipient, req.commissionAmount);

        if (req.referralAmount > 0) {
            IERC20(req.token).safeTransferFrom(req.payer, req.referralRecipient, req.referralAmount);
            if (req.referralRecipient == address(this)) {
                uint256 newBalance = _referralEscrowByRouteAndToken[routeKey][req.token] + req.referralAmount;
                _referralEscrowByRouteAndToken[routeKey][req.token] = newBalance;
                emit ReferralEscrowFunded(routeKey, req.groupId, req.token, req.referralAmount, newBalance);
            }
        }

        emit FundingRoutedWithReferral(
            req.groupId,
            req.payer,
            req.token,
            req.principalAmount,
            req.commissionAmount,
            req.referralAmount,
            req.reserveRecipient,
            req.commissionRecipient,
            req.referralRecipient,
            block.timestamp
        );
    }

    function releaseReferralReward(
        bytes32 releaseId,
        bytes32 groupId,
        address payer,
        address token,
        address beneficiary,
        uint256 amount
    ) external nonReentrant whenNotPaused onlyReleaseExecutor {
        require(!consumedReleaseIds[releaseId], "Release id already processed");
        require(!consumedReleases[releaseId], "Release already processed");
        require(beneficiary != address(0), "Invalid beneficiary");
        require(token != address(0), "Invalid token");
        require(amount > 0, "Amount must be > 0");

        bytes32 routeKey = _routeKey(groupId, payer);
        uint256 escrowBalance = _referralEscrowByRouteAndToken[routeKey][token];
        require(escrowBalance >= amount, "Insufficient escrow");

        consumedReleaseIds[releaseId] = true;
        consumedReleases[releaseId] = true;
        _referralEscrowByRouteAndToken[routeKey][token] = escrowBalance - amount;

        IERC20(token).safeTransfer(beneficiary, amount);

        emit ReferralRewardReleased(releaseId, routeKey, beneficiary, token, amount);
    }

    function releaseReferralEscrowToCommission(
        bytes32 releaseId,
        bytes32 groupId,
        address payer,
        address token,
        uint256 amount
    ) external nonReentrant whenNotPaused onlyReleaseExecutor {
        require(!consumedReleaseIds[releaseId], "Release id already processed");
        require(!consumedCommissionReleases[releaseId], "Commission release already processed");
        require(token != address(0), "Invalid token");
        require(amount > 0, "Amount must be > 0");

        address commissionWallet = referralFallbackCommissionWallet;
        require(commissionWallet != address(0), "Fallback commission wallet not configured");

        bytes32 routeKey = _routeKey(groupId, payer);
        uint256 escrowBalance = _referralEscrowByRouteAndToken[routeKey][token];
        require(escrowBalance >= amount, "Insufficient escrow");

        consumedReleaseIds[releaseId] = true;
        consumedCommissionReleases[releaseId] = true;
        _referralEscrowByRouteAndToken[routeKey][token] = escrowBalance - amount;

        IERC20(token).safeTransfer(commissionWallet, amount);

        emit ReferralCommissionReleaseExecuted(releaseId, routeKey, commissionWallet, token, amount);
    }

    function referralEscrowBalance(bytes32 groupId, address payer, address token) external view returns (uint256) {
        return _referralEscrowByRouteAndToken[_routeKey(groupId, payer)][token];
    }

    function canRoute(RouteRequest calldata req) external view returns (bool, string memory) {
        return _canRouteBase(
            req.groupId,
            req.payer,
            req.token,
            req.reserveRecipient,
            req.commissionRecipient,
            req.principalAmount,
            req.commissionAmount,
            req.deadline,
            req.nonce
        );
    }

    function canRouteWithReferral(RouteRequestWithReferral calldata req) external view returns (bool, string memory) {
        (bool ok, string memory reason) = _canRouteBase(
            req.groupId,
            req.payer,
            req.token,
            req.reserveRecipient,
            req.commissionRecipient,
            req.principalAmount,
            req.commissionAmount,
            req.deadline,
            req.nonce
        );
        if (!ok) return (false, reason);

        if (!_isValidReferralSplit(
            req.referralRecipient,
            req.referralAmount,
            req.reserveRecipient,
            req.commissionRecipient
        )) return (false, "Invalid referral split");

        return (true, "Can route with referral");
    }

    function setReleaseExecutor(address executor, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(executor != address(0), "Invalid executor");
        releaseExecutors[executor] = enabled;
        emit ReleaseExecutorUpdated(executor, enabled);
    }

    function setReferralFallbackCommissionWallet(address wallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(wallet != address(0), "Invalid commission wallet");
        referralFallbackCommissionWallet = wallet;
        emit ReferralFallbackCommissionWalletUpdated(wallet);
    }

    function allowlistToken(address token) external onlyRole(ALLOWLIST_ADMIN_ROLE) {
        require(token != address(0), "Invalid token");
        allowlistedTokens[token] = true;
        emit TokenAllowlisted(token);
    }

    function removeTokenFromAllowlist(address token) external onlyRole(ALLOWLIST_ADMIN_ROLE) {
        allowlistedTokens[token] = false;
        emit TokenRemovedFromAllowlist(token);
    }

    function allowlistRecipient(address recipient) external onlyRole(ALLOWLIST_ADMIN_ROLE) {
        require(recipient != address(0), "Invalid recipient");
        allowlistedRecipients[recipient] = true;
        emit RecipientAllowlisted(recipient);
    }

    function removeRecipientFromAllowlist(address recipient) external onlyRole(ALLOWLIST_ADMIN_ROLE) {
        allowlistedRecipients[recipient] = false;
        emit RecipientRemovedFromAllowlist(recipient);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
        emit RoutingPaused(true);
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
        emit RoutingPaused(false);
    }

    function emergencyWithdrawToken(address token, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(to != address(0), "Invalid recipient");
        require(token != address(0), "Invalid token");
        require(IERC20(token).balanceOf(address(this)) >= amount, "Insufficient balance");
        IERC20(token).safeTransfer(to, amount);
    }

    function _validateAndConsumeBaseRoute(
        bytes32 groupId,
        address payer,
        address token,
        address reserveRecipient,
        address commissionRecipient,
        uint256 principalAmount,
        uint256 commissionAmount,
        uint256 deadline,
        uint256 nonce
    ) internal returns (bytes32 routeKey) {
        routeKey = _routeKey(groupId, payer);

        require(msg.sender == payer, "Caller must be payer");
        require(block.timestamp <= deadline, "Request expired");
        require(!consumedRouteKeys[routeKey], "Route already processed (replay)");
        require(payerNonces[payer] == nonce, "Invalid nonce");
        require(token != address(0), "Invalid token");
        require(allowlistedTokens[token], "Token not allowlisted");
        require(reserveRecipient != address(0), "Invalid reserve recipient");
        require(commissionRecipient != address(0), "Invalid commission recipient");
        require(reserveRecipient != commissionRecipient, "Reserve and commission recipients must differ");
        require(allowlistedRecipients[reserveRecipient], "Reserve recipient not allowlisted");
        require(allowlistedRecipients[commissionRecipient], "Commission recipient not allowlisted");
        require(principalAmount > 0, "Principal must be > 0");
        require(commissionAmount > 0, "Commission must be > 0");

        consumedRouteKeys[routeKey] = true;
        payerNonces[payer]++;
    }

    function _validateReferralSplit(
        address referralRecipient,
        uint256 referralAmount,
        address reserveRecipient,
        address commissionRecipient
    ) internal view {
        if (referralAmount == 0) {
            require(referralRecipient == address(0), "Referral recipient must be zero when amount is zero");
            return;
        }

        require(referralRecipient != address(0), "Invalid referral recipient");
        require(allowlistedRecipients[referralRecipient], "Referral recipient not allowlisted");
        require(
            referralRecipient != reserveRecipient && referralRecipient != commissionRecipient,
            "Referral recipient must differ from reserve/commission"
        );
    }

    function _isValidReferralSplit(
        address referralRecipient,
        uint256 referralAmount,
        address reserveRecipient,
        address commissionRecipient
    ) internal view returns (bool) {
        if (referralAmount == 0) return referralRecipient == address(0);
        return
            referralRecipient != address(0) &&
            allowlistedRecipients[referralRecipient] &&
            referralRecipient != reserveRecipient &&
            referralRecipient != commissionRecipient;
    }

    function _canRouteBase(
        bytes32 groupId,
        address payer,
        address token,
        address reserveRecipient,
        address commissionRecipient,
        uint256 principalAmount,
        uint256 commissionAmount,
        uint256 deadline,
        uint256 nonce
    ) internal view returns (bool, string memory) {
        if (paused()) return (false, "Routing paused");
        if (payer == address(0)) return (false, "Invalid payer");
        if (block.timestamp > deadline) return (false, "Request expired");
        if (consumedRouteKeys[_routeKey(groupId, payer)]) return (false, "Route already processed");
        if (payerNonces[payer] != nonce) return (false, "Invalid nonce");
        if (token == address(0)) return (false, "Invalid token");
        if (!allowlistedTokens[token]) return (false, "Token not allowlisted");
        if (reserveRecipient == address(0)) return (false, "Invalid reserve recipient");
        if (commissionRecipient == address(0)) return (false, "Invalid commission recipient");
        if (reserveRecipient == commissionRecipient) return (false, "Reserve and commission recipients must differ");
        if (!allowlistedRecipients[reserveRecipient]) return (false, "Reserve recipient not allowlisted");
        if (!allowlistedRecipients[commissionRecipient]) return (false, "Commission recipient not allowlisted");
        if (principalAmount == 0) return (false, "Principal must be > 0");
        if (commissionAmount == 0) return (false, "Commission must be > 0");
        return (true, "Can route");
    }

    function _routeKey(bytes32 groupId, address payer) internal pure returns (bytes32) {
        return keccak256(abi.encode(groupId, payer));
    }
}
