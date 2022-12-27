import {
  NewChild,
  Implementation,
} from "../../generated/EmissionsERC20Factory/EmissionsERC20Factory";
import { EmissionsERC20 as EmissionsERC20Contract } from "../../generated/EmissionsERC20Factory/EmissionsERC20";
import { EmissionsERC20, EmissionsERC20Factory } from "../../generated/schema";
import { EmissionsERC20Template } from "../../generated/templates";
import { ONE_BI, ZERO_BI } from "../utils";

export function handleImplementation(event: Implementation): void {
  let emissionsERC20Factory = new EmissionsERC20Factory(event.address.toHex());
  emissionsERC20Factory.implementation = event.params.implementation;
  emissionsERC20Factory.address = event.address;
  emissionsERC20Factory.children = [];
  emissionsERC20Factory.childrenCount = ZERO_BI;
  emissionsERC20Factory.save();
}

export function handleNewChild(event: NewChild): void {
  let emissionsERC20 = new EmissionsERC20(event.params.child.toHex());
  let emissionsERC20Contract = EmissionsERC20Contract.bind(event.params.child);
  emissionsERC20.address = event.params.child;
  emissionsERC20.deployBlock = event.block.number;
  emissionsERC20.deployTimestamp = event.block.timestamp;
  emissionsERC20.deployer = event.transaction.from;
  emissionsERC20.factory = event.address.toHex();
  emissionsERC20.name = emissionsERC20Contract.name();
  emissionsERC20.symbol = emissionsERC20Contract.symbol();
  emissionsERC20.decimals = emissionsERC20Contract.decimals();
  emissionsERC20.totalSupply = emissionsERC20Contract.totalSupply();
  emissionsERC20.claims = [];
  emissionsERC20.save();

  let emissionsERC20Factory = EmissionsERC20Factory.load(event.address.toHex());
  if (emissionsERC20Factory) {
    let children = emissionsERC20Factory.children;
    if (children) children.push(emissionsERC20.id);
    emissionsERC20Factory.children = children;
    emissionsERC20Factory.childrenCount =
      emissionsERC20Factory.childrenCount.plus(ONE_BI);
    emissionsERC20Factory.save();
  }

  EmissionsERC20Template.create(event.params.child);
}
