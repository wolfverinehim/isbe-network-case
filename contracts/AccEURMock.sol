// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title AccEURMock
 * @dev ERC20 minimalista para pruebas (simula estable como USDT con 6 decimales).
 * Compatible con funciones usadas por la app: decimals, balanceOf, transfer,
 * approve, allowance, transferFrom.
 */
contract AccEURMock {
    string public name;
    string public symbol;
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    uint256 public immutable maxSupply;

    address public owner;
    address public pendingOwner;
    bool public paused;
    bool public mintingDisabled;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(
        address indexed owner,
        address indexed spender,
        uint256 value
    );
    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );
    event OwnershipTransferStarted(
        address indexed previousOwner,
        address indexed pendingOwner
    );
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event MintingDisabled(address indexed account);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Token paused");
        _;
    }

    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        address initialOwner,
        uint256 initialSupply,
        uint256 maxSupplyRaw
    ) {
        require(initialOwner != address(0), "Invalid owner");
        require(maxSupplyRaw > 0, "Invalid max supply");
        require(initialSupply <= maxSupplyRaw, "Initial supply exceeds max");

        name = tokenName;
        symbol = tokenSymbol;
        owner = initialOwner;
        maxSupply = maxSupplyRaw;
        paused = false;
        mintingDisabled = false;

        if (initialSupply > 0) {
            _mint(initialOwner, initialSupply);
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

    function mint(address to, uint256 amount) external onlyOwner whenNotPaused {
        require(!mintingDisabled, "Minting disabled");
        _mint(to, amount);
    }

    function burn(uint256 amount) external whenNotPaused {
        _burn(msg.sender, amount);
    }

    function pause() external onlyOwner {
        require(!paused, "Already paused");
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        require(paused, "Not paused");
        paused = false;
        emit Unpaused(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Only pending owner");
        address previousOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, owner);
    }

    function disableMinting() external onlyOwner {
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
