import "module-alias/register";
import { getAccounts } from "@utils/index";
import { Account } from "@utils/types";
const { expect } = require("chai");
const { ethers } = require("hardhat");

const erc20abi = require("./erc20abi");

const dpiAddress = "0x1494ca1f11d487c2bbe4543e90080aeba4ba3c2b";
const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";

const uniFactory = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
const uniRouter = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const sushiFactory = "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac";
const sushiRouter = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";
const basicIssuanceModule = "0xd8EF3cACe8b4907117a45B0b125c68560532F94D";

const deploy = async (account: Account) => {
  const ExchangeIssuance = await ethers.getContractFactory("ExchangeIssuance");
  return (await ExchangeIssuance.deploy(uniFactory, uniRouter, sushiFactory, sushiRouter, basicIssuanceModule)).connect(account.wallet);
};

describe("ExchangeIssuance", function() {

  let account: Account;

  before(async () => {
    [account] = await getAccounts();
  });

  it("Should issue DPI with ETH", async function() {
    // get initial ETH and DPI balances
    const dpi = new ethers.Contract(dpiAddress, erc20abi, account.wallet);
    // console.log(signer);
    const initDPIBalance = await dpi.balanceOf(account.wallet.address);
    const initETHBalance = await account.wallet.getBalance();

    // deploy ExchangeIssuance.sol
    const exchangeIssuance = await deploy(account);

    // issue 10 DPI using ETH
    await exchangeIssuance.initApprovals(dpiAddress);
    const overrides = {
        value: ethers.utils.parseEther("10"),
    };
    await exchangeIssuance.exchangeIssue(dpiAddress, ethers.utils.parseEther("20"), true, "0x0000000000000000000000000000000000000000", 0, overrides);

    // get final ETH and DPI balances
    const finalDPIBalance = await dpi.balanceOf(account.wallet.address);
    const finalETHBalance = await account.wallet.getBalance();

    // check if final DPI is greater than init, and if final ETH is less than init (accounting for gas fees)
    expect(finalDPIBalance.gt(initDPIBalance)).to.equal(true);
    expect(finalETHBalance.add(ethers.utils.parseEther("0.2")).lt(initETHBalance)).to.equal(true);
  });

  it("Should redeem DPI for ETH", async function() {
    // get initial ETH and DPI balances
    const dpi = new ethers.Contract(dpiAddress, erc20abi, account.wallet);
    const initDPIBalance = await dpi.balanceOf(account.wallet.address);
    const initETHBalance = await account.wallet.getBalance();

    // deploy ExchangeIssuance.sol
    const exchangeIssuance = await deploy(account);

    // redeem dpi for ETH
    await dpi.approve(exchangeIssuance.address, ethers.utils.parseEther("10"));
    await exchangeIssuance.initApprovals(dpiAddress);
    await exchangeIssuance.exchangeRedeem(dpiAddress,
      ethers.utils.parseEther("10"),
      true, "0x0000000000000000000000000000000000000000",
      ethers.utils.parseEther("1")
    );

    // get final ETH and DPI balances
    const finalDPIBalance = await dpi.balanceOf(account.wallet.address);
    const finalETHBalance = await account.wallet.getBalance();

    // check if final DPI is less than init, and if final ETH is more than init
    expect(finalDPIBalance.lt(initDPIBalance)).to.equal(true);
    expect(finalETHBalance.gt(initETHBalance)).to.equal(true);
  });

  it("Should redeem DPI for an ERC20 (DAI)", async function() {
    // get initial DPI and DAI balances
    const dpi = new ethers.Contract(dpiAddress, erc20abi, account.wallet);
    const initDPIBalance = await dpi.balanceOf(account.wallet.address);
    const dai = new ethers.Contract(daiAddress, erc20abi, account.wallet);
    const initDAIBalance = await dai.balanceOf(account.wallet.address);

    // deploy ExchangeIssuance.sol
    const exchangeIssuance = await deploy(account);

    // redeem DPI for DAI
    await dpi.approve(exchangeIssuance.address, ethers.utils.parseEther("10"));
    await exchangeIssuance.initApprovals(dpiAddress);
    await exchangeIssuance.exchangeRedeem(dpiAddress, ethers.utils.parseEther("10"), false, daiAddress, ethers.utils.parseEther("1000"));

    // get final DPI and DAI balances
    const finalDPIBalance = await dpi.balanceOf(account.wallet.address);
    const finalDAIBalance = await dai.balanceOf(account.wallet.address);

    // check if final DPI is less than init, and if final DAI is more than init
    expect(finalDPIBalance.lt(initDPIBalance)).to.equal(true);
    expect(finalDAIBalance.gt(initDAIBalance)).to.equal(true);
  });

  it("Should issue DPI with an ERC20 (DAI)", async function() {
    // get initial DPI and DAI balances
    const dpi = new ethers.Contract(dpiAddress, erc20abi, account.wallet);
    const initDPIBalance = await dpi.balanceOf(account.wallet.address);
    const dai = new ethers.Contract(daiAddress, erc20abi, account.wallet);
    const initDAIBalance = await dai.balanceOf(account.wallet.address);

    // deploy ExchangeIssuance.sol
    const exchangeIssuance = await deploy(account);

    // issue DPI with DAI
    await dai.approve(exchangeIssuance.address, ethers.utils.parseEther("10000"));
    await exchangeIssuance.initApprovals(dpiAddress);
    await exchangeIssuance.exchangeIssue(dpiAddress, ethers.utils.parseEther("5"), false, daiAddress, ethers.utils.parseEther("1900"));

    // get final DPI and DAI balances
    const finalDPIBalance = await dpi.balanceOf(account.wallet.address);
    const finalDAIBalance = await dai.balanceOf(account.wallet.address);

    // check if final DPI is less than init, and if final DAI is more than init
    expect(finalDPIBalance.gt(initDPIBalance)).to.equal(true);
    expect(finalDAIBalance.lt(initDAIBalance)).to.equal(true);
  });
});