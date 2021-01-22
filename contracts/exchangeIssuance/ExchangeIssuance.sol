pragma solidity >=0.6.10;
pragma experimental ABIEncoderV2;

import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "../lib/PreciseUnitMath.sol";
import "../../external/contracts/UniswapV2Library.sol";
import "../../external/contracts/SushiswapV2Library.sol";
import "../interfaces/ISetToken.sol";
import "../interfaces/IBasicIssuanceModule.sol";
import "../interfaces/IWETH.sol";

/**
 * @title ExchangeIssuance
 * @author Noah Citron
 *
 * Contract for minting and redeeming any Set token using
 * ETH or an ERC20 as the paying/receiving currency. All swaps are done using the best price
 * found on Uniswap or Sushiswap.
 *
 */
contract ExchangeIssuance is ReentrancyGuard {

    using SafeMath for uint256;
    
    /* ============ State Variables ============ */

    IUniswapV2Router02 private uniRouter;
    address private uniFactory;
    IUniswapV2Router02 private sushiRouter;
    address private sushiFactory;

    IBasicIssuanceModule private basicIssuanceModule;
    address private WETH;

    /* ============ Events ============ */

    event ExchangeIssue(address indexed recipient, address indexed setToken, address indexed inputToken, uint256 amount);
    event ExchangeRedeem(address indexed recipient, address indexed setToken, address indexed outputToken, uint256 amount);

    /* ============ Constructor ============ */

    constructor(
        address _uniFactory,
        IUniswapV2Router02 _uniRouter, 
        address _sushiFactory, 
        IUniswapV2Router02 _sushiRouter, 
        IBasicIssuanceModule _basicIssuanceModule
    ) 
        public
    {
        uniFactory = _uniFactory;
        uniRouter = _uniRouter;

        sushiFactory = _sushiFactory;
        sushiRouter = _sushiRouter;

        WETH = uniRouter.WETH();
        basicIssuanceModule = _basicIssuanceModule;
        IERC20(WETH).approve(address(uniRouter), PreciseUnitMath.maxUint256());
        IERC20(WETH).approve(address(sushiRouter), PreciseUnitMath.maxUint256());
    }

    /* ============ External Functions ============ */

    receive() external payable {}

    /**
     * Runs all the necessary approval functions required before issuing
     * or redeeming a set token. This function must only be called before the first time
     * this smart contract is used on any particular set token, or when a new token is added
     * to the set token.
     *
     * @param _setToken    Address of the set token being initialized
     */
    function initApprovals(address _setToken) external {
        ISetToken.Position[] memory positions = ISetToken(_setToken).getPositions();
        for (uint256 i=0; i<positions.length; i++) {
            IERC20 token = IERC20(positions[i].component);
            token.approve(address(uniRouter), PreciseUnitMath.maxUint256());
            token.approve(address(sushiRouter), PreciseUnitMath.maxUint256());
            token.approve(address(basicIssuanceModule), PreciseUnitMath.maxUint256());
        }
    }

    /**
     * Redeems a set token and sells the underlying tokens using Uniswap
     * or Sushiswap.
     *
     * @param _setToken        Address of the set token being redeemed
     * @param _amount       The amount of the set token to redeem
     * @param _isOutputETH  Set to true if the output token is Ether
     * @param _outputToken  Address of output token. Ignored if _isOutputETH is true
     */
    function exchangeRedeem(ISetToken _setToken, uint256 _amount, bool _isOutputETH, address _outputToken, uint256 minReceive) external nonReentrant {
        _setToken.transferFrom(msg.sender, address(this), _amount);
        basicIssuanceModule.redeem(_setToken, _amount, address(this));
        liquidateComponents(_setToken);
        if(_isOutputETH) {
            require(address(this).balance > minReceive, "INSUFFICIENT_OUTPUT_AMOUNT");
            msg.sender.transfer(address(this).balance);
        } else if (_outputToken == WETH) {
            require(address(this).balance > minReceive, "INSUFFICIENT_OUTPUT_AMOUNT");
            IWETH(WETH).deposit{value: address(this).balance}();
            IERC20(WETH).transfer(msg.sender, IERC20(WETH).balanceOf(address(this)));
        } else {
            uint256 outputAmount = purchaseTokenExactEther(_outputToken, address(this).balance);
            require(outputAmount > minReceive, "INSUFFICIENT_OUTPUT_AMOUNT");
        }
        emit ExchangeRedeem(msg.sender, address(_setToken), _isOutputETH ? address(0) : _outputToken, _amount);
    }

    /**
     * Issues an set token by using swapping for the underlying tokens on Uniswap
     * or Sushiswap. msg.value must be equal to the maximum price in ETH that you are
     * willing to pay. Excess ETH is refunded.
     *
     * @param _setToken     Address of the set token being issued
     * @param _amount       Amount of the set token to issue
     * @param _isInputETH   Set to true if the input token is Ether
     * @param _inputToken   Address of input token. Ignored if _isInputETH is true
     * @param _maxSpend     Max erc20 balance to spend on issuing. Ignored if _isInputETH 
     *                      is true as _maxSpend is then equal to msg.value
     */
    function exchangeIssue(ISetToken _setToken, uint256 _amount, bool _isInputETH, IERC20 _inputToken, uint256 _maxSpend) external payable nonReentrant {
        if (!_isInputETH && address(_inputToken) != WETH) {
            _inputToken.transferFrom(msg.sender, address(this), _maxSpend);
            purchaseEtherExactTokens(address(_inputToken), _inputToken.balanceOf(address(this)));
        } else if (!_isInputETH && address(_inputToken) == WETH) {
            _inputToken.transferFrom(msg.sender, address(this), _maxSpend);
            IWETH(WETH).withdraw(IERC20(WETH).balanceOf(address(this)));
        }

        (address[] memory tokens, uint256[] memory tokenAmounts) = getTokensNeeded(_setToken, _amount);
        acquireComponents(tokens, tokenAmounts);
        basicIssuanceModule.issue(_setToken, _amount, msg.sender);

        if (_isInputETH && address(this).balance > 0) {
            msg.sender.transfer(address(this).balance);
        } else if (address(_inputToken) != WETH && address(this).balance > 0) {
            purchaseTokenExactEther(address(_inputToken), address(this).balance);
            _inputToken.transfer(msg.sender, _inputToken.balanceOf(address(this)));
        } else {
            IWETH(WETH).deposit{value: address(this).balance}();
            _inputToken.transfer(msg.sender, _inputToken.balanceOf(address(this)));
        }
        emit ExchangeIssue(msg.sender, address(_setToken), _isInputETH ? address(0) : address(_inputToken), _amount);
    }

    /* ============ Internal Functions ============ */

    function liquidateComponents(ISetToken _setToken) internal {
        ISetToken.Position[] memory positions = _setToken.getPositions();
        for (uint256 i=0; i<positions.length; i++) {
            sellTokenBestPrice(positions[i].component);
        }
    }

    function acquireComponents(address[] memory tokens, uint256[] memory tokenAmounts) internal {
        IWETH(WETH).deposit{value: address(this).balance}();
        for (uint256 i=0; i<tokens.length; i++) {
            purchaseTokenBestPrice(tokens[i], tokenAmounts[i]);
        }
        IWETH(WETH).withdraw(IERC20(WETH).balanceOf(address(this)));
    }

    function purchaseToken(IUniswapV2Router02 _router, address _token, uint256 _amount) internal {
        address[] memory path = new address[](2);
        path[0] = WETH;
        path[1] = _token;
        _router.swapTokensForExactTokens(_amount, PreciseUnitMath.maxUint256(), path, address(this), block.timestamp);
    }

    function purchaseTokenBestPrice(address _token, uint256 _amount) internal {
        uint256 uniPrice = tokenAvailable(uniFactory, _token) ? getBuyPrice(true, _token, _amount) : PreciseUnitMath.maxUint256();
        uint256 sushiPrice = tokenAvailable(sushiFactory, _token) ? getBuyPrice(false, _token, _amount) : PreciseUnitMath.maxUint256();
        if (uniPrice <= sushiPrice) {
            purchaseToken(uniRouter, _token, _amount);
        } else {
            purchaseToken(sushiRouter, _token, _amount);
        }
    }

    /**
     * purchases the given token using the given amount of Ether
     * 
     * @param _token    address of token to purhcase
     * @param _amount   amount of Ether to spend on purchase
     * @return          amount of token purchased
     */
    function purchaseTokenExactEther(address _token, uint256 _amount) internal returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = WETH;
        path[1] = _token;

        uint256 uniAmountOut = tokenAvailable(uniFactory, _token) ? uniRouter.getAmountsOut(_amount, path)[1] : 0;
        uint256 sushiAmountOut = tokenAvailable(sushiFactory, _token) ? sushiRouter.getAmountsOut(_amount, path)[1] : 0;
        IUniswapV2Router02 router = uniAmountOut >= sushiAmountOut ? uniRouter : sushiRouter;

        uint256[] memory outputAmounts = router.swapExactETHForTokens{value: _amount}(0, path, msg.sender, block.timestamp);
        return outputAmounts[1];
    }

    function sellToken(IUniswapV2Router02 _router, address _token) internal {
        uint256 tokenBalance = IERC20(_token).balanceOf(address(this));
        address[] memory path = new address[](2);
        path[0] = _token;
        path[1] = WETH;
        _router.swapExactTokensForETH(tokenBalance, 0, path, address(this), block.timestamp);
    }

    function sellTokenBestPrice(address _token) internal {
        uint256 tokenBalance = IERC20(_token).balanceOf(address(this));
        uint256 uniPrice = tokenAvailable(uniFactory, _token) ? getSellPrice(true, _token, tokenBalance) : 0;
        uint256 sushiPrice = tokenAvailable(sushiFactory, _token) ? getSellPrice(false, _token, tokenBalance) : 0;
        if (uniPrice >= sushiPrice) {
            sellToken(uniRouter, _token);
        } else {
            sellToken(sushiRouter, _token);
        }
    }

    /**
     * Purchases an Ether given an exact amount of a token to spend
     *
     * @param _token    token to spend
     * @param _amount   amount of token to spend
     */
    function purchaseEtherExactTokens(address _token, uint256 _amount) internal {
        address[] memory path = new address[](2);
        path[0] = _token;
        path[1] = WETH;

        uint256 uniAmountOut = tokenAvailable(uniFactory, _token) ? uniRouter.getAmountsOut(_amount, path)[1] : 0;
        uint256 sushiAmountOut = tokenAvailable(sushiFactory, _token) ? sushiRouter.getAmountsOut(_amount, path)[1] : 0;
        IUniswapV2Router02 router = uniAmountOut >= sushiAmountOut ? uniRouter : sushiRouter;

        IERC20(_token).approve(address(router), PreciseUnitMath.maxUint256());
        router.swapExactTokensForETH(_amount, 0, path, address(this), block.timestamp);
    }

    /**
     * Gets the components of a set and the corresponding amount needed
     *
     * @param _setToken     set token
     * @param _amount       amount of the set token
     * @return              a tuple containing arrays of component token addresses and amounts of tokens needed
     */
    function getTokensNeeded(ISetToken _setToken, uint256 _amount) internal view returns (address[] memory, uint256[] memory) {
        ISetToken.Position[] memory positions = _setToken.getPositions();
        uint256[] memory tokenAmounts = new uint256[](positions.length);
        address[] memory tokens = new address[](positions.length);
        for (uint256 i=0; i<positions.length; i++) {
            uint256 tokensNeeded =  PreciseUnitMath.preciseMulCeil(uint256(positions[i].unit), _amount);
            tokenAmounts[i] = tokensNeeded;
            tokens[i] = positions[i].component;
        }
        return (tokens, tokenAmounts);
    }

    function getBuyPrice(bool isUni, address _token, uint256 _amount) internal view returns (uint256) {
        if (isUni) {
            (uint256 tokenReserveA, uint256 tokenReserveB) = UniswapV2Library.getReserves(uniFactory, WETH, _token);
            return uniRouter.getAmountIn(_amount, tokenReserveA, tokenReserveB);
        } else {
            (uint256 tokenReserveA, uint256 tokenReserveB) = SushiswapV2Library.getReserves(sushiFactory, WETH, _token);
            return sushiRouter.getAmountIn(_amount, tokenReserveA, tokenReserveB);
        }
    }

    function getSellPrice(bool isUni, address _token, uint256 _amount) internal view returns (uint256) {
        if (isUni) {
            (uint256 tokenReserveA, uint256 tokenReserveB) = UniswapV2Library.getReserves(uniFactory, WETH, _token);
            return uniRouter.getAmountOut(_amount, tokenReserveB, tokenReserveA);
        } else {
            (uint256 tokenReserveA, uint256 tokenReserveB) = SushiswapV2Library.getReserves(sushiFactory, WETH, _token);
            return sushiRouter.getAmountOut(_amount, tokenReserveB, tokenReserveA);
        }
    }

    function tokenAvailable(address _factory, address _token) internal view returns (bool) {
        return IUniswapV2Factory(_factory).getPair(WETH, _token) != address(0);
    }
}