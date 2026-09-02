// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title AccEURMock
 * @dev ERC20 con 6 decimales (flujos tipo USDT) adaptado a la Modalidad 2 de ISBE:
 * RBAC via AccessControl y pausabilidad estandar con PAUSER_ROLE para la
 * gobernanza de ISBE.
 */
contract AccEURMock is AccessControl, Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    string public name;
    string public symbol;
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    uint256 public immutable maxSupply;

    bool public mintingDisabled;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(
        address indexed owner,
        address indexed spender,
        uint256 value
    );
    event MintingDisabled(address indexed account);

    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        address admin,
        address isbeGovernance,
        uint256 initialSupply,
        uint256 maxSupplyRaw
    ) {
        require(admin != address(0), "Invalid admin");
        require(isbeGovernance != address(0), "Invalid ISBE governance");
        require(maxSupplyRaw > 0, "Invalid max supply");
        require(initialSupply <= maxSupplyRaw, "Initial supply exceeds max");

        name = tokenName;
        symbol = tokenSymbol;
        maxSupply = maxSupplyRaw;
        mintingDisabled = false;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(PAUSER_ROLE, isbeGovernance);

        if (initialSupply > 0) {
            _mint(admin, initialSupply);
        }
    }

    function transfer(
        address to,
        uint256 amount
    ) external whenNotPaused returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(
        address spender,
        uint256 amount
    ) external whenNotPaused returns (bool) {
        require(spender != address(0), "Invalid spender");
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function increaseAllowance(
        address spender,
        uint256 addedValue
    ) external whenNotPaused returns (bool) {
        require(spender != address(0), "Invalid spender");
        uint256 newAllowance = allowance[msg.sender][spender] + addedValue;
        allowance[msg.sender][spender] = newAllowance;
        emit Approval(msg.sender, spender, newAllowance);
        return true;
    }

    function decreaseAllowance(
        address spender,
        uint256 subtractedValue
    ) external whenNotPaused returns (bool) {
        require(spender != address(0), "Invalid spender");
        uint256 currentAllowance = allowance[msg.sender][spender];
        require(currentAllowance >= subtractedValue, "Decreased below zero");

        unchecked {
            allowance[msg.sender][spender] = currentAllowance - subtractedValue;
        }
        emit Approval(msg.sender, spender, allowance[msg.sender][spender]);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external whenNotPaused returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        require(currentAllowance >= amount, "Insufficient allowance");

        unchecked {
            allowance[from][msg.sender] = currentAllowance - amount;
        }
        emit Approval(from, msg.sender, allowance[from][msg.sender]);

        _transfer(from, to, amount);
        return true;
    }

    function mint(
        address to,
        uint256 amount
    ) external onlyRole(MINTER_ROLE) whenNotPaused {
        require(!mintingDisabled, "Minting disabled");
        _mint(to, amount);
    }

    function burn(uint256 amount) external whenNotPaused {
        _burn(msg.sender, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function disableMinting()
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        whenNotPaused
    {
        require(!mintingDisabled, "Minting already disabled");
        mintingDisabled = true;
        emit MintingDisabled(msg.sender);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0), "Invalid from");
        require(to != address(0), "Invalid to");

        uint256 fromBalance = balanceOf[from];
        require(fromBalance >= amount, "Insufficient balance");

        unchecked {
            balanceOf[from] = fromBalance - amount;
        }
        balanceOf[to] += amount;

        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "Invalid to");
        require(totalSupply + amount <= maxSupply, "Max supply exceeded");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        require(from != address(0), "Invalid from");

        uint256 fromBalance = balanceOf[from];
        require(fromBalance >= amount, "Insufficient balance");

        unchecked {
            balanceOf[from] = fromBalance - amount;
        }
        totalSupply -= amount;

        emit Transfer(from, address(0), amount);
    }
}
