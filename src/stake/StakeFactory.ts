import {
  Implementation,
  NewChild,
} from "../../generated/StakeFactory/StakeFactory";
import { Stake } from "../../generated/templates/StakeERC20Template/Stake";
import { StakeFactory, StakeERC20 } from "../../generated/schema";
import { ONE_BI, ZERO_ADDRESS, ZERO_BD, ZERO_BI } from "../utils";
import { StakeERC20Template } from "../../generated/templates";
export function handleImplementation(event: Implementation): void {
  let stakeFactory = new StakeFactory(event.address.toHex());
  stakeFactory.implementation = event.params.implementation;
  stakeFactory.children = [];
  stakeFactory.childrenCount = ZERO_BI;
  stakeFactory.address = event.address;
  stakeFactory.save();
}

export function handleNewChild(event: NewChild): void {
  let stakeFactory = StakeFactory.load(event.address.toHex());
  if (stakeFactory) {
    let stakeERC20 = new StakeERC20(event.params.child.toHex());
    let stakeContract = Stake.bind(event.params.child);
    let stakeContractTotalSupply = stakeContract.totalSupply();
    stakeERC20.totalSupply = stakeContractTotalSupply;
    stakeERC20.address = event.params.child;
    stakeERC20.deployer = event.transaction.from;
    stakeERC20.deployBlock = event.block.number;
    stakeERC20.deployTimestamp = event.block.timestamp;
    stakeERC20.factory = stakeFactory.id;
    stakeERC20.token = ZERO_ADDRESS;
    stakeERC20.tokenPoolSize = ZERO_BI;
    stakeERC20.initialRatio = ZERO_BI;
    stakeERC20.tokenToStakeTokenRatio = ZERO_BD;
    stakeERC20.stakeTokenToTokenRatio = ZERO_BD;

    stakeERC20.save();

    let children = stakeFactory.children;
    if (children) children.push(stakeERC20.id);
    stakeFactory.children = children;
    stakeFactory.childrenCount = stakeFactory.childrenCount.plus(ONE_BI);
    stakeFactory.save();

    StakeERC20Template.create(event.params.child);
  }
}
