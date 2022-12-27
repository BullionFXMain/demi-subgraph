import { expect } from "chai";
import { ethers } from "hardhat";
import * as Util from "./utils/utils";
import { waitForSubgraphToBeSynced } from "./utils/utils";

// Typechain Factories
import { ReserveTokenTest__factory } from "../typechain/factories/ReserveTokenTest__factory";

// Types
import type { FetchResult } from "apollo-fetch";

import type { ReserveTokenTest } from "../typechain/ReserveTokenTest";
import type {
  Stake,
  StakeConfigStruct,
  TransferEvent,
} from "../typechain/Stake";

import {
  // Subgraph
  subgraph,
  // Signers
  deployer,
  signer1,
  // Contracts factories
  stakeFactory,
} from "./1_initQueries.test";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

async function deployStake(
  deployerAccount: SignerWithAddress,
  config?: StakeConfigStruct
): Promise<{ _stake: Stake; _reserveToken: ReserveTokenTest }> {
  let stakeConfig: StakeConfigStruct = config;
  let _reserveToken: ReserveTokenTest;

  if (!config) {
    _reserveToken = await new ReserveTokenTest__factory(
      deployerAccount
    ).deploy();
    stakeConfig = {
      name: "Stake Token",
      symbol: "STKN",
      token: _reserveToken.address,
      initialRatio: Util.ONE,
    };
  }

  const _stake = await Util.stakeDeploy(
    stakeFactory,
    deployerAccount,
    stakeConfig
  );

  return { _stake, _reserveToken };
}

describe.only("Stake queries test", function () {
  describe("StakeFactory entity", async () => {
    it("should query all the basic fields correctly", async () => {
      // Get the Sale implementation
      const implementation = await Util.getImplementation(stakeFactory);

      const query = `
      {
        stakeFactory (id: "${stakeFactory.address.toLowerCase()}") {
          address
          implementation
          children
          childrenCount
        }
      }
    `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const data = response.data.stakeFactory;

      expect(data.address).to.equals(stakeFactory.address.toLowerCase());
      expect(data.implementation).to.equals(implementation.toLowerCase());
      expect(data.children).to.be.empty;
      expect(data.childrenCount).to.equals("0");
    });

    it("should query multiples Stake from the entity correctly", async () => {
      // Deploying two sales to be query
      const { _stake: stake1 } = await deployStake(deployer);
      const { _stake: stake2 } = await deployStake(deployer);

      await waitForSubgraphToBeSynced();

      const query = `
      {
        stakeFactory (id: "${stakeFactory.address.toLowerCase()}") {
          children {
            id
          }
        }
      }
    `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const data = response.data.stakeFactory;

      expect(data.children).to.deep.include({
        id: stake1.address.toLowerCase(),
      });
      expect(data.children).to.deep.include({
        id: stake2.address.toLowerCase(),
      });
    });
  });

  describe("StakeHolder queries", () => {
    it("should query a StakeHolder after a deposit correctly", async () => {
      const { _stake, _reserveToken } = await deployStake(deployer);

      const tokenPoolSize0_ = await _reserveToken.balanceOf(_stake.address);
      const totalSupply0_ = await _stake.totalSupply();
      const amountToDeposit = ethers.BigNumber.from("1000" + Util.sixZeros);

      // Checking init values
      expect(tokenPoolSize0_).to.be.equals(totalSupply0_);
      expect(tokenPoolSize0_).to.be.equals("0");

      // signer1 deposits reserve tokens
      await _reserveToken.transfer(signer1.address, amountToDeposit);
      await _reserveToken
        .connect(signer1)
        .approve(_stake.address, amountToDeposit);
      const depositTx = await _stake.connect(signer1).deposit(amountToDeposit);

      const { value } = (await Util.getEventArgs(
        depositTx,
        "Transfer",
        _stake
      )) as TransferEvent["args"];

      const signer1StakeBalance = await _stake.balanceOf(signer1.address);

      expect(signer1StakeBalance).to.be.equals(value);

      expect(await _reserveToken.balanceOf(_stake.address)).to.be.equals(
        await _stake.totalSupply()
      );

      await waitForSubgraphToBeSynced();

      const stakeHolder = `${_stake.address.toLowerCase()}-${signer1.address.toLowerCase()}`;

      const query = `
      {
        stakeHolder(id: "${stakeHolder}") {
          address
          token {
            id
          }
          stakeToken {
            id
          }
          balance
          totalStake
          totalDeposited
          deposits {
            id
          }
          withdraws {
            id
          }
        }
      }
    `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const data = response.data.stakeHolder;

      expect(data.address).to.be.equals(signer1.address.toLowerCase());
      expect(data.token.id).to.be.equals(_reserveToken.address.toLowerCase());
      expect(data.stakeToken.id).to.be.equals(_stake.address.toLowerCase());

      expect(data.balance).to.be.equals(signer1StakeBalance);
      expect(data.totalStake).to.be.equals(amountToDeposit);
      expect(data.totalDeposited).to.be.equals(amountToDeposit);

      expect(data.deposits).to.have.lengthOf(1);
      expect(data.withdraws).to.be.empty;
    });
  });
});
