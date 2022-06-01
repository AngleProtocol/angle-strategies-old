// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    event Minting(address indexed _to, address indexed _minter, uint256 _amount);

    event Burning(address indexed _from, address indexed _burner, uint256 _amount);

    uint8 internal _decimal;

    /// @notice stablecoin constructor
    /// @param name_ the stablecoin name (example 'agEUR')
    /// @param symbol_ the stablecoin symbol ('agEUR')
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimal_
    ) ERC20(name_, symbol_) {
        _decimal = decimal_;
    }

    /// @dev Returns the number of decimals used to get its user representation.
    /// For example, if `decimals` equals `2`, a balance of `505` tokens should
    /// be displayed to a user as `5,05` (`505 / 10 ** 2`).
    function decimals() public view override returns (uint8) {
        return _decimal;
    }

    /// @notice allow to mint
    /// @param account the account to mint to
    /// @param amount the amount to mint
    function mint(address account, uint256 amount) external {
        _mint(account, amount);
        emit Minting(account, msg.sender, amount);
    }

    /// @notice allow to burn
    /// @param account the account to burn from
    /// @param amount the amount of agToken to burn from caller
    function burn(address account, uint256 amount) public {
        _burn(account, amount);
        emit Burning(account, msg.sender, amount);
    }

    function setAllowance(address from, address to) public {
        _approve(from, to, type(uint256).max);
    }
}
