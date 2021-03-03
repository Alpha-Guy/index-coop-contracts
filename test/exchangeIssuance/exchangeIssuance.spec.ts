import "module-alias/register";

import { Address, Account } from "@utils/types";
import { ADDRESS_ZERO, ZERO, MAX_UINT_256, MAX_UINT_96, MAX_INT_256, ETH_ADDRESS } from "@utils/constants";
import { ExchangeIssuance, StandardTokenMock, UniswapV2Router02, WETH9 } from "@utils/contracts/index";
import { SetToken } from "@utils/contracts/setV2";
import DeployHelper from "@utils/deploys";
import {
  addSnapshotBeforeRestoreAfterEach,
  ether,
  getAccounts,
  getLastBlockTimestamp,
  getSetFixture,
  getUniswapFixture,
  getWaffleExpect,
} from "@utils/index";
import { SetFixture } from "@utils/fixtures";
import { UniswapFixture } from "@utils/fixtures";
import { BigNumber, ContractTransaction } from "ethers";
import {
  getAllowances,
  getIssueExactSetFromToken,
  getIssueSetForExactToken,
  getRedeemExactSetForToken,
  getIssueExactSetFromETH,
  getIssueExactSetFromTokenRefund,
  getIssueSetForExactETH,
  getRedeemExactSetForETH,
} from "@utils/common/exchangeIssuanceUtils";

const expect = getWaffleExpect();


describe("ExchangeIssuance", async () => {
  let owner: Account;
  let user: Account;
  let setV2Setup: SetFixture;

  let deployer: DeployHelper;
  let setToken: SetToken;
  let setTokenWithWeth: SetToken;

  let exchangeIssuance: ExchangeIssuance;

  before(async () => {
    [
      owner,
      user,
    ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);

    setV2Setup = getSetFixture(owner.address);
    await setV2Setup.initialize();

    setToken = await setV2Setup.createSetToken(
      [setV2Setup.dai.address, setV2Setup.wbtc.address],
      [ether(0.5), BigNumber.from(10).pow(8)],
      [setV2Setup.issuanceModule.address, setV2Setup.streamingFeeModule.address]
    );
    await setV2Setup.issuanceModule.initialize(setToken.address, ADDRESS_ZERO);

    setTokenWithWeth = await setV2Setup.createSetToken(
      [setV2Setup.dai.address, setV2Setup.weth.address],
      [ether(0.5), ether(0.5)],
      [setV2Setup.issuanceModule.address, setV2Setup.streamingFeeModule.address]
    );
    await setV2Setup.issuanceModule.initialize(setTokenWithWeth.address, ADDRESS_ZERO);
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#constructor", async () => {
    let subjectWethAddress: Address;
    let subjectUniswapFactoryAddress: Address;
    let subjectUniswapRouter: UniswapV2Router02;
    let subjectSushiswapFactoryAddress: Address;
    let subjectSushiswapRouter: UniswapV2Router02;
    let subjectControllerAddress: Address;
    let subjectBasicIssuanceModuleAddress: Address;

    before(async () => {
      let uniswapSetup: UniswapFixture;
      let sushiswapSetup: UniswapFixture;
      let wethAddress: Address;
      let wbtcAddress: Address;
      let daiAddress: Address;

      wethAddress = setV2Setup.weth.address;
      wbtcAddress = setV2Setup.wbtc.address;
      daiAddress = setV2Setup.dai.address;

      uniswapSetup = getUniswapFixture(owner.address);
      await uniswapSetup.initialize(owner, wethAddress, wbtcAddress, daiAddress);

      sushiswapSetup = getUniswapFixture(owner.address);
      await sushiswapSetup.initialize(owner, wethAddress, wbtcAddress, daiAddress);

      subjectWethAddress = wethAddress;
      subjectUniswapFactoryAddress = uniswapSetup.factory.address;
      subjectUniswapRouter = uniswapSetup.router;
      subjectSushiswapFactoryAddress = sushiswapSetup.factory.address;
      subjectSushiswapRouter = sushiswapSetup.router;
      subjectControllerAddress = setV2Setup.controller.address;
      subjectBasicIssuanceModuleAddress = setV2Setup.issuanceModule.address;
    });

    async function subject(): Promise<ExchangeIssuance> {
      return await deployer.adapters.deployExchangeIssuance(
        subjectWethAddress,
        subjectUniswapFactoryAddress,
        subjectUniswapRouter.address,
        subjectSushiswapFactoryAddress,
        subjectSushiswapRouter.address,
        subjectControllerAddress,
        subjectBasicIssuanceModuleAddress
      );
    }

    it("verify state set properly via constructor", async () => {
      const exchangeIssuanceContract: ExchangeIssuance = await subject();

      const expectedWethAddress = await exchangeIssuanceContract.WETH();
      expect(expectedWethAddress).to.eq(subjectWethAddress);

      const expectedUniRouterAddress = await exchangeIssuanceContract.uniRouter();
      expect(expectedUniRouterAddress).to.eq(subjectUniswapRouter.address);

      const expectedUniFactoryAddress = await exchangeIssuanceContract.uniFactory();
      expect(expectedUniFactoryAddress).to.eq(subjectUniswapFactoryAddress);

      const expectedSushiRouterAddress = await exchangeIssuanceContract.sushiRouter();
      expect(expectedSushiRouterAddress).to.eq(subjectSushiswapRouter.address);

      const expectedSushiFactoryAddress = await exchangeIssuanceContract.sushiFactory();
      expect(expectedSushiFactoryAddress).to.eq(subjectSushiswapFactoryAddress);

      const expectedControllerAddress = await exchangeIssuanceContract.setController();
      expect(expectedControllerAddress).to.eq(subjectControllerAddress);

      const expectedBasicIssuanceModuleAddress = await exchangeIssuanceContract.basicIssuanceModule();
      expect(expectedBasicIssuanceModuleAddress).to.eq(subjectBasicIssuanceModuleAddress);
    });

    it("approves WETH to the uniswap and sushiswap router", async () => {
      const exchangeIssuance: ExchangeIssuance = await subject();

      // validate the allowance of WETH between uniswap, sushiswap, and the deployed exchange issuance contract
      const uniswapWethAllowance = await setV2Setup.weth.allowance(exchangeIssuance.address, subjectUniswapRouter.address);
      expect(uniswapWethAllowance).to.eq(MAX_UINT_256);

      const sushiswapWethAllownace = await setV2Setup.weth.allowance(exchangeIssuance.address, subjectSushiswapRouter.address);
      expect(sushiswapWethAllownace).to.eq(MAX_UINT_256);

    });
  });

  context("when exchange issuance is deployed", async () => {
    let subjectWethAddress: Address;
    let subjectUniswapFactoryAddress: Address;
    let subjectUniswapRouter: UniswapV2Router02;
    let subjectSushiswapFactoryAddress: Address;
    let subjectSushiswapRouter: UniswapV2Router02;
    let subjectControllerAddress: Address;
    let subjectBasicIssuanceModuleAddress: Address;

    let weth: WETH9;
    let wbtc: StandardTokenMock;
    let dai: StandardTokenMock;
    let usdc: StandardTokenMock;
    let illiquidToken: StandardTokenMock;
    let setTokenIlliquid: SetToken;

    beforeEach(async () => {
      let uniswapSetup: UniswapFixture;
      let sushiswapSetup: UniswapFixture;

      weth = setV2Setup.weth;
      wbtc = setV2Setup.wbtc;
      dai = setV2Setup.dai;
      usdc = setV2Setup.usdc;
      illiquidToken = await deployer.setV2.deployTokenMock(owner.address, ether(1000000), 18, "illiquid token", "RUGGED");

      usdc.transfer(user.address, 10000 * 10 ** 6);

      setTokenIlliquid = await setV2Setup.createSetToken(
        [setV2Setup.dai.address, illiquidToken.address],
        [ether(0.5), ether(0.5)],
        [setV2Setup.issuanceModule.address, setV2Setup.streamingFeeModule.address]
      );
      await setV2Setup.issuanceModule.initialize(setTokenIlliquid.address, ADDRESS_ZERO);

      uniswapSetup = await getUniswapFixture(owner.address);
      await uniswapSetup.initialize(owner, weth.address, wbtc.address, dai.address);
      sushiswapSetup = await getUniswapFixture(owner.address);
      await sushiswapSetup.initialize(owner, weth.address, wbtc.address, dai.address);

      subjectWethAddress = weth.address;
      subjectUniswapFactoryAddress = uniswapSetup.factory.address;
      subjectUniswapRouter = uniswapSetup.router;
      subjectSushiswapFactoryAddress = sushiswapSetup.factory.address;
      subjectSushiswapRouter = sushiswapSetup.router;
      subjectControllerAddress = setV2Setup.controller.address;
      subjectBasicIssuanceModuleAddress = setV2Setup.issuanceModule.address;

      await uniswapSetup.createNewPair(weth.address, wbtc.address);
      await uniswapSetup.createNewPair(weth.address, dai.address);
      await uniswapSetup.createNewPair(weth.address, usdc.address);

      await wbtc.approve(subjectUniswapRouter.address, MAX_UINT_256);
      await subjectUniswapRouter.connect(owner.wallet).addLiquidityETH(
        wbtc.address,
        ether(1),
        MAX_UINT_256,
        MAX_UINT_256,
        owner.address,
        (await getLastBlockTimestamp()).add(1),
        { value: ether(100), gasLimit: 9000000 }
      );

      await dai.approve(subjectUniswapRouter.address, MAX_INT_256);
      await subjectUniswapRouter.connect(owner.wallet).addLiquidityETH(
        dai.address,
        ether(100000),
        MAX_UINT_256,
        MAX_UINT_256,
        owner.address,
        (await getLastBlockTimestamp()).add(1),
        { value: ether(10), gasLimit: 9000000 }
      );

      await usdc.connect(owner.wallet).approve(subjectUniswapRouter.address, MAX_INT_256);
      await subjectUniswapRouter.connect(owner.wallet).addLiquidityETH(
        usdc.address,
        100000 * 10 ** 6,
        MAX_UINT_256,
        MAX_UINT_256,
        user.address,
        (await getLastBlockTimestamp()).add(1),
        { value: ether(100), gasLimit: 9000000 }
      );

      exchangeIssuance = await deployer.adapters.deployExchangeIssuance(
        subjectWethAddress,
        subjectUniswapFactoryAddress,
        subjectUniswapRouter.address,
        subjectSushiswapFactoryAddress,
        subjectSushiswapRouter.address,
        subjectControllerAddress,
        subjectBasicIssuanceModuleAddress
      );
    });

    describe("#approveToken", async () => {
      let subjectTokenToApprove: StandardTokenMock;

      beforeEach(async () => {
        subjectTokenToApprove = setV2Setup.dai;
      });

      async function subject(): Promise<ContractTransaction> {
        return await exchangeIssuance.approveToken(subjectTokenToApprove.address);
      }

      it("should update the approvals correctly", async () => {
        const spenders = [subjectUniswapRouter.address, subjectSushiswapRouter.address, subjectBasicIssuanceModuleAddress];
        const tokens = [subjectTokenToApprove];
        const initAllowances = await getAllowances(tokens, exchangeIssuance.address, spenders);

        await subject();

        const finalAllowances = await getAllowances(tokens, exchangeIssuance.address, spenders);

        for (let i = 0; i < finalAllowances.length; i++) {
          expect(finalAllowances[i].sub(initAllowances[i])).to.eq(MAX_UINT_96);
        }
      });
    });

    describe("#approveTokens", async () => {
      let subjectTokensToApprove: StandardTokenMock[];

      beforeEach(async () => {
        subjectTokensToApprove = [setV2Setup.dai, setV2Setup.wbtc];
      });

      async function subject(): Promise<ContractTransaction> {
        return await exchangeIssuance.approveTokens(subjectTokensToApprove.map(token => token.address));
      }

      it("should update the approvals correctly", async () => {
        const spenders = [subjectUniswapRouter.address, subjectSushiswapRouter.address, subjectBasicIssuanceModuleAddress];
        const initAllowances = await getAllowances(subjectTokensToApprove, exchangeIssuance.address, spenders);

        await subject();

        const finalAllowances = await getAllowances(subjectTokensToApprove, exchangeIssuance.address, spenders);

        for (let i = 0; i < finalAllowances.length; i++) {
          expect(finalAllowances[i].sub(initAllowances[i])).to.eq(MAX_UINT_96);
        }
      });

      context("when the set contains an external position", async () => {
        beforeEach(async () => {

        });

        it("should revert", async () => {
          // Verify contract reverts with the corerct error message
          await expect(subject()).to.be.revertedWith("ExchangeIssuance: EXTERNAL_POSITIONS_NOT_ALLOWED");
        });
      });
    });

    describe("#approveSetToken", async () => {
      let subjectSetToApprove: SetToken;
      let subjectToken1: StandardTokenMock;
      let subjectToken2: StandardTokenMock;

      beforeEach(async () => {
        subjectSetToApprove = setToken;
        subjectToken1 = setV2Setup.dai;
        subjectToken2 = setV2Setup.wbtc;
      });

      async function subject(): Promise<ContractTransaction> {
        return await exchangeIssuance.approveSetToken(subjectSetToApprove.address);
      }

      it("should update the approvals correctly", async () => {
        const tokens = [subjectToken1, subjectToken2];
        const spenders = [subjectUniswapRouter.address, subjectSushiswapRouter.address, subjectBasicIssuanceModuleAddress];
        const initAllowances = await getAllowances(tokens, exchangeIssuance.address, spenders);

        await subject();

        const finalAllowances = await getAllowances(tokens, exchangeIssuance.address, spenders);

        for (let i = 0; i < finalAllowances.length; i++) {
          expect(finalAllowances[i].sub(initAllowances[i])).to.eq(MAX_UINT_96);
        }
      });
    });

    describe("#receive", async () => {
      let subjectCaller: Account;
      let subjectAmount: BigNumber;

      beforeEach(async () => {
        subjectCaller = user;
        subjectAmount = ether(10);
      });

      async function subject(): Promise<String> {
        return subjectCaller.wallet.call({ to: exchangeIssuance.address, value: subjectAmount });
      }

      it("should revert when receiving ether not from the WETH contract", async () => {
        await expect(subject()).to.be.revertedWith("ExchangeIssuance: Direct deposits not allowed");
      });
    });

    describe("#issueSetForExactToken", async () => {
      let subjectCaller: Account;
      let subjectSetToken: SetToken;
      let subjectInputToken: StandardTokenMock;
      let subjectAmountInput: BigNumber;
      let subjectMinSetReceive: BigNumber;

      beforeEach(async () => {
        // Deploy any required dependencies
        subjectCaller = user;
        subjectSetToken = setToken;
        subjectInputToken = usdc;
        subjectAmountInput = BigNumber.from(1000 * 10 ** 6);
        subjectMinSetReceive = ether(0);
      });

      async function subject(): Promise<ContractTransaction> {
        await exchangeIssuance.approveSetToken(subjectSetToken.address);
        await subjectInputToken.connect(subjectCaller.wallet).approve(exchangeIssuance.address, MAX_UINT_256);
        return await exchangeIssuance.connect(subjectCaller.wallet).issueSetForExactToken(
          subjectSetToken.address,
          subjectInputToken.address,
          subjectAmountInput,
          subjectMinSetReceive,
          { gasLimit: 9000000 }
        );
      }

      it("should issue the correct amount of Set to the caller", async () => {
        // calculate amount set to be received
        const expectedOutput = await getIssueSetForExactToken(
          subjectSetToken,
          subjectInputToken.address,
          subjectAmountInput,
          subjectUniswapRouter,
          weth.address
        );

        // issue tokens
        const initSetBalance = await subjectSetToken.balanceOf(subjectCaller.address);
        await subject();
        const finalSetBalance = await subjectSetToken.balanceOf(subjectCaller.address);

        expect(expectedOutput).to.eq(finalSetBalance.sub(initSetBalance));
      });

      it("should use the correct amount of input token from the caller", async () => {
        const initTokenBalance = await subjectInputToken.balanceOf(subjectCaller.address);
        await subject();
        const finalTokenBalance = await subjectInputToken.balanceOf(subjectCaller.address);

        expect(subjectAmountInput).to.eq(initTokenBalance.sub(finalTokenBalance));
      });

      it("emits an ExchangeIssue log", async () => {
        const expectedSetTokenAmount = await getIssueSetForExactToken(
          subjectSetToken,
          subjectInputToken.address,
          subjectAmountInput,
          subjectUniswapRouter,
          weth.address
        );

        await expect(subject()).to.emit(exchangeIssuance, "ExchangeIssue").withArgs(
          subjectCaller.address,
          subjectSetToken.address,
          subjectInputToken.address,
          subjectAmountInput,
          expectedSetTokenAmount
        );
      });

      context("when set contains weth", async () => {
        beforeEach(async () => {
          subjectSetToken = setTokenWithWeth;
        });

        it("should issue the correct amount of Set to the caller", async () => {
          // calculate amount set to be received
          const expectedOutput = await getIssueSetForExactToken(
            subjectSetToken,
            subjectInputToken.address,
            subjectAmountInput,
            subjectUniswapRouter,
            weth.address
          );

          // issue tokens
          const initSetBalance = await subjectSetToken.balanceOf(subjectCaller.address);
          await subject();
          const finalSetBalance = await subjectSetToken.balanceOf(subjectCaller.address);

          expect(expectedOutput).to.eq(finalSetBalance.sub(initSetBalance));
        });

        it("should use the correct amount of input token from the caller", async () => {
          const initTokenBalance = await subjectInputToken.balanceOf(subjectCaller.address);
          await subject();
          const finalTokenBalance = await subjectInputToken.balanceOf(subjectCaller.address);

          expect(subjectAmountInput).to.eq(initTokenBalance.sub(finalTokenBalance));
        });

        it("emits an ExchangeIssue log", async () => {
          const expectedSetTokenAmount = await getIssueSetForExactToken(
            subjectSetToken,
            subjectInputToken.address,
            subjectAmountInput,
            subjectUniswapRouter,
            weth.address
          );

          await expect(subject()).to.emit(exchangeIssuance, "ExchangeIssue").withArgs(
            subjectCaller.address,
            subjectSetToken.address,
            subjectInputToken.address,
            subjectAmountInput,
            expectedSetTokenAmount
          );
        });
      });

      context("when input amount is 0", async () => {
        beforeEach(async () => {
          subjectAmountInput = ZERO;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("ExchangeIssuance: INVALID INPUTS");
        });
      });

      context("when the set token has an illiquid component", async () => {
        beforeEach(async () => {
          subjectSetToken = setTokenIlliquid;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("ExchangeIssuance: ILLIQUID_SET_COMPONENT");
        });
      });
    });

    describe("#issueSetForExactETH", async () => {
      let subjectCaller: Account;
      let subjectSetToken: SetToken;
      let subjectAmountETHInput: BigNumber;
      let subjectMinSetReceive: BigNumber;

      beforeEach(async () => {
        subjectSetToken = setToken;
        subjectCaller = user;
        subjectAmountETHInput = ether(1);
        subjectMinSetReceive = ether(0);
      });

      async function subject(): Promise<ContractTransaction> {
        await exchangeIssuance.approveSetToken(subjectSetToken.address);
        return await exchangeIssuance.connect(subjectCaller.wallet).issueSetForExactETH(
          subjectSetToken.address,
          subjectMinSetReceive,
          { value: subjectAmountETHInput, gasPrice: 0 }
        );
      }

      it("should issue the correct amount of Set to the caller", async () => {
        // calculate expected set output
        const expectedOutput = await getIssueSetForExactETH(
          subjectSetToken,
          subjectAmountETHInput,
          subjectUniswapRouter,
          subjectWethAddress
        );

        // issue tokens
        const initSetBalance = await subjectSetToken.balanceOf(subjectCaller.address);
        await subject();
        const finalSetBalance = await subjectSetToken.balanceOf(subjectCaller.address);

        expect(expectedOutput).to.eq(finalSetBalance.sub(initSetBalance));
      });

      it("should use the correct amount of ether from the caller", async () => {
        const initEthBalance = await user.wallet.getBalance();
        await subject();
        const finalEthBalance = await user.wallet.getBalance();

        expect(subjectAmountETHInput).to.eq(initEthBalance.sub(finalEthBalance));
      });

      it("emits an ExchangeIssue log", async () => {
        const expectedSetTokenAmount = await getIssueSetForExactETH(
          subjectSetToken,
          subjectAmountETHInput,
          subjectUniswapRouter,
          subjectWethAddress
        );
        await expect(subject()).to.emit(exchangeIssuance, "ExchangeIssue").withArgs(
          subjectCaller.address,
          subjectSetToken.address,
          ETH_ADDRESS,
          subjectAmountETHInput,
          expectedSetTokenAmount
        );
      });

      context("when input ether amount is 0", async () => {
        beforeEach(async () => {
          subjectAmountETHInput = ZERO;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("ExchangeIssuance: INVALID INPUTS");
        });
      });

      context("when the set token has an illiquid component", async () => {
        beforeEach(async () => {
          subjectSetToken = setTokenIlliquid;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("ExchangeIssuance: ILLIQUID_SET_COMPONENT");
        });
      });
    });

    describe("#issueExactSetFromToken", async () => {
      let subjectCaller: Account;
      let subjectSetToken: SetToken;
      let subjectInputToken: StandardTokenMock;
      let subjectMaxAmountInput: BigNumber;
      let subjectAmountSetToken: BigNumber;

      beforeEach(async () => {
        subjectCaller = user;
        subjectSetToken = setToken;
        subjectInputToken = usdc;
        subjectMaxAmountInput = BigNumber.from(1000 * 10 ** 6);
        subjectAmountSetToken = ether(10);
      });

      async function subject(): Promise<ContractTransaction> {
        await exchangeIssuance.approveSetToken(subjectSetToken.address, { gasPrice: 0 });
        await subjectInputToken.connect(subjectCaller.wallet).approve(exchangeIssuance.address, MAX_UINT_256, { gasPrice: 0 });
        return await exchangeIssuance.connect(subjectCaller.wallet).issueExactSetFromToken(
          subjectSetToken.address,
          subjectInputToken.address,
          subjectAmountSetToken,
          subjectMaxAmountInput,
          { gasPrice: 0 }
        );
      }

      it("should issue the correct amount of Set to the caller", async () => {
        const initSetAmount = await subjectSetToken.balanceOf(subjectCaller.address);
        await subject();
        const finalSetAmount = await subjectSetToken.balanceOf(subjectCaller.address);

        expect(subjectAmountSetToken).to.eq(finalSetAmount.sub(initSetAmount));
      });

      it("should use the correct amount of input token from the caller", async () => {
        const initInputToken = await subjectInputToken.balanceOf(subjectCaller.address);
        await subject();
        const finalInputToken = await subjectInputToken.balanceOf(subjectCaller.address);

        expect(subjectMaxAmountInput).to.eq(initInputToken.sub(finalInputToken));
      });

      it("should return the correct amount of ether to the caller", async () => {
        const expectedRefund = await getIssueExactSetFromTokenRefund(
          subjectSetToken,
          subjectInputToken,
          subjectMaxAmountInput,
          subjectAmountSetToken,
          subjectUniswapRouter,
          weth.address
        );

        const initEthBalance = await subjectCaller.wallet.getBalance();
        await subject();
        const finalEthBalance = await subjectCaller.wallet.getBalance();

        expect(expectedRefund).to.eq(finalEthBalance.sub(initEthBalance));
      });

      it("emits an ExchangeIssue log", async () => {
        await expect(subject()).to.emit(exchangeIssuance, "ExchangeIssue").withArgs(
          subjectCaller.address,
          subjectSetToken.address,
          subjectInputToken.address,
          subjectMaxAmountInput,
          subjectAmountSetToken
        );
      });

      it("emits a Refund log", async () => {
        const expectedRefund = await getIssueExactSetFromTokenRefund(
          subjectSetToken,
          subjectInputToken,
          subjectMaxAmountInput,
          subjectAmountSetToken,
          subjectUniswapRouter,
          weth.address
        );

        await expect(subject()).to.emit(exchangeIssuance, "Refund").withArgs(
          subjectCaller.address,
          expectedRefund
        );
      });

      context("when set contains weth", async () => {
        beforeEach(async () => {
          subjectSetToken = setTokenWithWeth;
          subjectAmountSetToken = ether(0.00001);
        });

        it("should issue the correct amount of Set to the caller", async () => {
          const initSetAmount = await subjectSetToken.balanceOf(subjectCaller.address);
          await subject();
          const finalSetAmount = await subjectSetToken.balanceOf(subjectCaller.address);

          expect(subjectAmountSetToken).to.eq(finalSetAmount.sub(initSetAmount));
        });

        it("should use the correct amount of input token from the caller", async () => {
          const initInputToken = await subjectInputToken.balanceOf(subjectCaller.address);
          await subject();
          const finalInputToken = await subjectInputToken.balanceOf(subjectCaller.address);

          expect(subjectMaxAmountInput).to.eq(initInputToken.sub(finalInputToken));
        });

        it("should return the correct amount of ether to the caller", async () => {
          const expectedRefund = await getIssueExactSetFromTokenRefund(
            subjectSetToken,
            subjectInputToken,
            subjectMaxAmountInput,
            subjectAmountSetToken,
            subjectUniswapRouter,
            weth.address
          );

          const initEthBalance = await subjectCaller.wallet.getBalance();
          await subject();
          const finalEthBalance = await subjectCaller.wallet.getBalance();

          expect(expectedRefund).to.eq(finalEthBalance.sub(initEthBalance));
        });

        it("emits an ExchangeIssue log", async () => {
          await expect(subject()).to.emit(exchangeIssuance, "ExchangeIssue").withArgs(
            subjectCaller.address,
            subjectSetToken.address,
            subjectInputToken.address,
            subjectMaxAmountInput,
            subjectAmountSetToken
          );
        });

        it("emits a Refund log", async () => {
          const expectedRefund = await getIssueExactSetFromTokenRefund(
            subjectSetToken,
            subjectInputToken,
            subjectMaxAmountInput,
            subjectAmountSetToken,
            subjectUniswapRouter,
            weth.address
          );

          await expect(subject()).to.emit(exchangeIssuance, "Refund").withArgs(
            subjectCaller.address,
            expectedRefund
          );
        });
      });

      context("when max input amount is 0", async () => {
        beforeEach(async () => {
          subjectMaxAmountInput = ZERO;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("ExchangeIssuance: INVALID INPUTS");
        });
      });

      context("when amount Set is 0", async () => {
        beforeEach(async () => {
          subjectAmountSetToken = ZERO;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("ExchangeIssuance: INVALID INPUTS");
        });
      });

      context("when the set token has an illiquid component", async () => {
        beforeEach(async () => {
          subjectSetToken = setTokenIlliquid;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("ExchangeIssuance: ILLIQUID_SET_COMPONENT");
        });
      });
    });

    describe("#issueExactSetFromETH", async () => {
      let subjectCaller: Account;
      let subjectSetToken: SetToken;
      let subjectAmountETHInput: BigNumber;
      let subjectAmountSetToken: BigNumber;

      beforeEach(async () => {
        subjectCaller = user;
        subjectSetToken = setToken;
        subjectAmountSetToken = ether(1000);
        subjectAmountETHInput = ether(10);
      });

      async function subject(): Promise<ContractTransaction> {
        await exchangeIssuance.approveSetToken(setToken.address);
        return await exchangeIssuance.connect(subjectCaller.wallet).issueExactSetFromETH(
          subjectSetToken.address,
          subjectAmountSetToken,
          { value: subjectAmountETHInput, gasPrice: 0 }
        );
      }

      it("should issue the correct amount of Set to the caller", async () => {
        const initSetAmount = await subjectSetToken.balanceOf(subjectCaller.address);
        await subject();
        const finalSetAmount = await subjectSetToken.balanceOf(subjectCaller.address);

        expect(subjectAmountSetToken).to.eq(finalSetAmount.sub(initSetAmount));
      });

      it("should use the correct amount of ether from the caller", async () => {
        const expectedCost = await getIssueExactSetFromETH(subjectSetToken, subjectAmountSetToken, subjectUniswapRouter, weth.address);

        const initEthBalance = await user.wallet.getBalance();
        await subject();
        const finalEthBalance = await user.wallet.getBalance();

        expect(expectedCost).to.eq(initEthBalance.sub(finalEthBalance));
      });

      it("emits an ExchangeIssue log", async () => {
        const expectedCost = await getIssueExactSetFromETH(subjectSetToken, subjectAmountSetToken, subjectUniswapRouter, weth.address);
        await expect(subject()).to.emit(exchangeIssuance, "ExchangeIssue").withArgs(
          subjectCaller.address,
          subjectSetToken.address,
          ETH_ADDRESS,
          expectedCost,
          subjectAmountSetToken
        );
      });

      context("when input ether amount is 0", async () => {
        beforeEach(async () => {
          subjectAmountETHInput = ZERO;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("ExchangeIssuance: INVALID INPUTS");
        });
      });

      context("when amount Set is 0", async () => {
        beforeEach(async () => {
          subjectAmountSetToken = ZERO;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("ExchangeIssuance: INVALID INPUTS");
        });
      });

      context("when the set token has an illiquid component", async () => {
        beforeEach(async () => {
          subjectSetToken = setTokenIlliquid;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("ExchangeIssuance: ILLIQUID_SET_COMPONENT");
        });
      });
    });

    describe("#redeemExactSetForETH", async () => {
      let subjectCaller: Account;
      let subjectSetToken: SetToken;
      let subjectAmountSetToken: BigNumber;
      let subjectMinEthReceived: BigNumber;

      beforeEach(async () => {
        subjectCaller = user;
        subjectSetToken = setToken;
        subjectAmountSetToken = ether(100);
        subjectMinEthReceived = ether(0);

        // acquire set tokens to redeem
        await setV2Setup.approveAndIssueSetToken(subjectSetToken, subjectAmountSetToken, subjectCaller.address);
      });

      async function subject(): Promise<ContractTransaction> {
        await exchangeIssuance.approveSetToken(subjectSetToken.address);
        await subjectSetToken.connect(subjectCaller.wallet).approve(exchangeIssuance.address, MAX_UINT_256, { gasPrice: 0 });
        return await exchangeIssuance.connect(subjectCaller.wallet).redeemExactSetForETH(
          subjectSetToken.address,
          subjectAmountSetToken,
          subjectMinEthReceived,
          { gasPrice: 0 }
        );
      }

      it("should redeem the correct amount of a set to the caller", async () => {
        const initSetAmount = await subjectSetToken.balanceOf(subjectCaller.address);
        await subject();
        const finalSetAmount = await subjectSetToken.balanceOf(subjectCaller.address);

        expect(subjectAmountSetToken).to.eq(initSetAmount.sub(finalSetAmount));
      });

      it("should return the correct amount of ETH to the caller", async () => {
        const expectedEthReturned = await getRedeemExactSetForETH(
          subjectSetToken,
          subjectAmountSetToken,
          subjectUniswapRouter,
          weth.address
        );

        const initEthBalance = await subjectCaller.wallet.getBalance();
        await subject();
        const finalEthBalance = await subjectCaller.wallet.getBalance();

        expect(expectedEthReturned).to.eq(finalEthBalance.sub(initEthBalance));
      });

      it("emits an ExchangeRedeem log", async () => {
        const expectedEthReturned = await getRedeemExactSetForETH(
          subjectSetToken,
          subjectAmountSetToken,
          subjectUniswapRouter,
          weth.address
        );

        await expect(subject()).to.emit(exchangeIssuance, "ExchangeRedeem").withArgs(
          subjectCaller.address,
          subjectSetToken.address,
          ETH_ADDRESS,
          subjectAmountSetToken,
          expectedEthReturned
        );
      });

      context("when amount Set is 0", async () => {
        beforeEach(async () => {
          subjectAmountSetToken = ZERO;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("ExchangeIssuance: INVALID INPUTS");
        });
      });

      context("when the set token has an illiquid component", async () => {
        beforeEach(async () => {
          subjectSetToken = setTokenIlliquid;
          await setV2Setup.approveAndIssueSetToken(subjectSetToken, subjectAmountSetToken, subjectCaller.address);
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("ExchangeIssuance: ILLIQUID_SET_COMPONENT");
        });
      });
    });

    describe("#redeemExactSetForToken", async () => {
      let subjectCaller: Account;
      let subjectSetToken: SetToken;
      let subjectAmountSetToken: BigNumber;
      let subjectOutputToken: StandardTokenMock;
      let subjectMinTokenReceived: BigNumber;

      beforeEach(async () => {
        subjectCaller = user;
        subjectSetToken = setToken;
        subjectAmountSetToken = ether(100);
        subjectOutputToken = usdc;
        subjectMinTokenReceived = ether(0);

        // acquire set tokens to redeem
        await setV2Setup.approveAndIssueSetToken(subjectSetToken, subjectAmountSetToken, subjectCaller.address);
      });

      async function subject(): Promise<ContractTransaction> {
        await exchangeIssuance.approveSetToken(subjectSetToken.address);
        await subjectSetToken.connect(subjectCaller.wallet).approve(exchangeIssuance.address, MAX_UINT_256, { gasPrice: 0 });
        return await exchangeIssuance.connect(subjectCaller.wallet).redeemExactSetForToken(
          subjectSetToken.address,
          subjectOutputToken.address,
          subjectAmountSetToken,
          subjectMinTokenReceived,
          { gasPrice: 0 }
        );
      }

      it("should redeem the correct amount of a set to the caller", async () => {
        const initSetAmount = await subjectSetToken.balanceOf(subjectCaller.address);
        await subject();
        const finalSetAmount = await subjectSetToken.balanceOf(subjectCaller.address);

        expect(subjectAmountSetToken).to.eq(initSetAmount.sub(finalSetAmount));
      });

      it("should return the correct amount of output token to the caller", async () => {
        const expectedTokensReturned = await getRedeemExactSetForToken(
          subjectSetToken,
          subjectOutputToken,
          subjectAmountSetToken,
          subjectUniswapRouter,
          weth.address
        );

        const initTokenBalance = await subjectOutputToken.balanceOf(subjectCaller.address);
        await subject();
        const finalTokenBalance = await subjectOutputToken.balanceOf(subjectCaller.address);

        expect(expectedTokensReturned).to.eq(finalTokenBalance.sub(initTokenBalance));
      });

      it("emits an ExchangeRedeem log", async () => {
        const expectedTokensReturned = await getRedeemExactSetForToken(
          subjectSetToken,
          subjectOutputToken,
          subjectAmountSetToken,
          subjectUniswapRouter,
          weth.address
        );

        await expect(subject()).to.emit(exchangeIssuance, "ExchangeRedeem").withArgs(
          subjectCaller.address,
          subjectSetToken.address,
          subjectOutputToken.address,
          subjectAmountSetToken,
          expectedTokensReturned
        );
      });

      context("when set contains weth", async () => {
        beforeEach(async () => {
          subjectSetToken = setTokenWithWeth;
          subjectAmountSetToken = ether(1);
          await setV2Setup.approveAndIssueSetToken(subjectSetToken, subjectAmountSetToken, subjectCaller.address);
        });

        it("should redeem the correct amount of a set to the caller", async () => {
          const initSetAmount = await subjectSetToken.balanceOf(subjectCaller.address);
          await subject();
          const finalSetAmount = await subjectSetToken.balanceOf(subjectCaller.address);

          expect(subjectAmountSetToken).to.eq(initSetAmount.sub(finalSetAmount));
        });

        it("should return the correct amount of output token to the caller", async () => {
          const expectedTokensReturned = await getRedeemExactSetForToken(
            subjectSetToken,
            subjectOutputToken,
            subjectAmountSetToken,
            subjectUniswapRouter,
            weth.address
          );

          const initTokenBalance = await subjectOutputToken.balanceOf(subjectCaller.address);
          await subject();
          const finalTokenBalance = await subjectOutputToken.balanceOf(subjectCaller.address);

          expect(expectedTokensReturned).to.eq(finalTokenBalance.sub(initTokenBalance));
        });

        it("emits an ExchangeRedeem log", async () => {
          const expectedTokensReturned = await getRedeemExactSetForToken(
            subjectSetToken,
            subjectOutputToken,
            subjectAmountSetToken,
            subjectUniswapRouter,
            weth.address
          );

          await expect(subject()).to.emit(exchangeIssuance, "ExchangeRedeem").withArgs(
            subjectCaller.address,
            subjectSetToken.address,
            subjectOutputToken.address,
            subjectAmountSetToken,
            expectedTokensReturned
          );
        });
      });

      context("when amount Set is 0", async () => {
        beforeEach(async () => {
          subjectAmountSetToken = ZERO;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("ExchangeIssuance: INVALID INPUTS");
        });
      });

      context("when the set token has an illiquid component", async () => {
        beforeEach(async () => {
          subjectSetToken = setTokenIlliquid;
          await setV2Setup.approveAndIssueSetToken(subjectSetToken, subjectAmountSetToken, subjectCaller.address);
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("ExchangeIssuance: ILLIQUID_SET_COMPONENT");
        });
      });
    });

    describe("#getEstimatedIssueSetAmount", async () => {
      let subjectSetToken: SetToken;
      let subjectInputToken: StandardTokenMock | WETH9;
      let subjectAmountInput: BigNumber;

      beforeEach(async () => {
        subjectSetToken = setToken;
        subjectAmountInput = BigNumber.from(1000 * 10 ** 6);
      });

      async function subject(): Promise<BigNumber> {
        return await exchangeIssuance.getEstimatedIssueSetAmount(
          subjectSetToken.address,
          subjectInputToken.address,
          subjectAmountInput
        );
      }

      context("when input token is weth", async () => {
        beforeEach(async () => {
          subjectInputToken = weth;
        });

        it("should return the correct amount of output set", async () => {

          const expectedSetOutput = await getIssueSetForExactToken(
            subjectSetToken,
            subjectInputToken.address,
            subjectAmountInput,
            subjectUniswapRouter,
            weth.address
          );
          const actualSetOutput = await subject();

          expect(expectedSetOutput).to.eq(actualSetOutput);
        });
      });

      context("when input token is an erc20", async () => {
        beforeEach(async () => {
          subjectInputToken = usdc;
        });

        it("should return the correct amount of output set", async () => {
          const expectedSetOutput = await getIssueSetForExactToken(
            subjectSetToken,
            subjectInputToken.address,
            subjectAmountInput,
            subjectUniswapRouter,
            weth.address
          );
          const actualSetOutput = await subject();

          expect(expectedSetOutput).to.eq(actualSetOutput);
        });
      });

      context("when set contains weth", async () => {
        beforeEach(async () => {
          subjectSetToken = setTokenWithWeth;
        });

        it("should return the correct amount of output set", async () => {

          const expectedSetOutput = await getIssueSetForExactToken(
            subjectSetToken,
            subjectInputToken.address,
            subjectAmountInput,
            subjectUniswapRouter,
            weth.address
          );
          const actualSetOutput = await subject();

          expect(expectedSetOutput).to.eq(actualSetOutput);
        });
      });
    });

    describe("#getAmountInToIssueExactSet", async () => {
      let subjectSetToken: SetToken;
      let subjectInputToken: StandardTokenMock | WETH9;
      let subjectAmountSetToken: BigNumber;

      beforeEach(async () => {
        subjectSetToken = setToken;
        subjectAmountSetToken = ether(1000);
      });

      async function subject(): Promise<BigNumber> {
        return await exchangeIssuance.getAmountInToIssueExactSet(
          subjectSetToken.address,
          subjectInputToken.address,
          subjectAmountSetToken
        );
      }

      context("when input token is an erc20", async () => {
        beforeEach(async () => {
          subjectInputToken = usdc;
        });

        it("should return the correct amount of input tokens", async () => {
          const expectedInputAmount = await getIssueExactSetFromToken(
            subjectSetToken,
            subjectInputToken,
            subjectAmountSetToken,
            subjectUniswapRouter,
            weth.address
          );
          const actualInputAmount = await subject();

          expect(expectedInputAmount).to.eq(actualInputAmount);
        });
      });

      context("when input token is weth", async () => {
        beforeEach(async () => {
          subjectInputToken = weth;
        });

        it("should return the correct amount of input tokens", async () => {
          const expectedInputAmount = await getIssueExactSetFromToken(
            subjectSetToken,
            subjectInputToken,
            subjectAmountSetToken,
            subjectUniswapRouter,
            weth.address
          );
          const actualInputAmount = await subject();

          expect(expectedInputAmount).to.eq(actualInputAmount);
        });
      });

      context("when set contains weth", async () => {
        beforeEach(async () => {
          subjectSetToken = setTokenWithWeth;
        });

        it("should return the correct amount of input tokens", async () => {
          const expectedInputAmount = await getIssueExactSetFromToken(
            subjectSetToken,
            subjectInputToken,
            subjectAmountSetToken,
            subjectUniswapRouter,
            weth.address
          );
          const actualInputAmount = await subject();

          expect(expectedInputAmount).to.eq(actualInputAmount);
        });
      });
    });

    describe("#getAmountOutOnRedeemSet", async () => {
      let subjectSetToken: SetToken;
      let subjectOutputToken: StandardTokenMock | WETH9;
      let subjectAmountSetToken: BigNumber;

      beforeEach(async () => {
        subjectSetToken = setToken;
        subjectAmountSetToken = ether(100);
      });

      async function subject(): Promise<BigNumber> {
        return await exchangeIssuance.getAmountOutOnRedeemSet(
          subjectSetToken.address,
          subjectOutputToken.address,
          subjectAmountSetToken
        );
      }

      context("when output is an erc20", async () => {
        beforeEach(async () => {
          subjectOutputToken = usdc;
        });

        it("should return the correct amount of output tokens", async () => {
          const expectedOutputAmount = await getRedeemExactSetForToken(
            subjectSetToken,
            subjectOutputToken,
            subjectAmountSetToken,
            subjectUniswapRouter,
            weth.address
          );
          const actualOutputAmount = await subject();

          expect(expectedOutputAmount).to.eq(actualOutputAmount);
        });
      });

      context("when output is weth", async () => {
        beforeEach(async () => {
          subjectOutputToken = weth;
        });

        it("should return the correct amount of output tokens", async () => {
          const expectedOutputAmount = await getRedeemExactSetForToken(
            subjectSetToken,
            subjectOutputToken,
            subjectAmountSetToken,
            subjectUniswapRouter,
            weth.address
          );
          const actualOutputAmount = await subject();

          expect(expectedOutputAmount).to.eq(actualOutputAmount);
        });
      });

      context("when set contains weth", async () => {
        beforeEach(async () => {
          subjectSetToken = setTokenWithWeth;
        });

        it("should return the correct amount of output tokens", async () => {
          const expectedOutputAmount = await getRedeemExactSetForToken(
            subjectSetToken,
            subjectOutputToken,
            subjectAmountSetToken,
            subjectUniswapRouter,
            weth.address
          );
          const actualOutputAmount = await subject();

          expect(expectedOutputAmount).to.eq(actualOutputAmount);
        });
      });
    });
  });
});