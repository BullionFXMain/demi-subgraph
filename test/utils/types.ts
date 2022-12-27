import type { BigNumber } from "ethers";

export interface Trust {
  id: string;
  block: BigNumber;
  timestamp: BigNumber;
  creator: string;
  contracts: Contract;
  distributionProgress: DistributionProgress;
  trustParticipants: TrustParticipant[];
  notices: Notice[];
}

export interface TrustFactoryQuery {
  id: string;
  trustCount: BigNumber;
  trusts: Trust[];
}

// event Notice(address indexed sender, bytes data);
export interface Notice {
  id: string;
  trust: Trust;
  sender: string;
  data: string;
  block: BigNumber;
  timestamp: BigNumber;
}

export interface Contract {
  id: string;
  reserveERC20: ReserveERC20;
  redeemableERC20: RedeemableERC20;
  redeemableERC20Pool: RedeemableERC20Pool;
  seeder: SeedERC20;
  tier: string;
  crp: CRP;
  pool: Pool;
}

export interface DistributionProgress {
  id: string;
  distributionStatus: number;
  distributionStartBlock: BigNumber; // Trust.getDistributionProgress() => uint32 distributionStartBlock
  distributionEndBlock: BigNumber; // Trust.getDistributionProgress() => uint32 distributionEndBlock
  minimumTradingDuration: BigNumber; // RedeemableERC20Pool.minimumTradingDuration()
  poolReserveBalance: BigNumber; // Trust.getDistributionProgress() => uint256 poolReserveBalance
  poolTokenBalance: BigNumber; // Trust.getDistributionProgress() => uint256 poolTokenBalance
  minimumCreatorRaise: BigNumber; // Trust.getDistributionProgress() => uint256 minimumCreatorRaise
  finalWeight: BigNumber; // RedeemableERC20Pool.finalWeight()
  finalValuation: BigNumber; // RedeemableERC20Pool.finalValuation()
  successPoolBalance: BigNumber; // Trust.successBalance()
  finalBalance: BigNumber; // Trust.finalBalance()
  reserveInit: BigNumber; // Trust.getDistributionProgress() => uint256 reserveInit
  redeemInit: BigNumber; // Trust.getDistributionProgress() => uint256 redeemInit
  minimumRaise: BigNumber; // minimumCreatorRaise + redeemInit + Trust.SeedERC20.seederFee
  amountRaised: BigNumber; // = poolReserveBalance - reserveInit
  percentRaised: string; // = amountRaised / minimumRaise
  percentAvailable: string; // = poolTokenBalance / RedeemableERC20.totalSupply
}

export interface CRP {
  id: string;
  block: BigNumber; // the block the contract was deployed
  timestamp: BigNumber; // the timestamp the contract was deployed
}

export interface RedeemableERC20Pool {
  id: string;
  block: BigNumber; // the block the contract was deployed
  timestamp: BigNumber; // the timestamp the contract was deployed
}

export interface ReserveERC20 {
  id: string;
  symbol: string;
  totalSupply: BigNumber;
  decimals: number;
  name: string;
  block: BigNumber; // the block the contract was deployed
  timestamp: BigNumber; // the timestamp the contract was deployed
}

export interface Redeemable {
  id: string;
  symbol: string;
  totalSupply: BigNumber;
  decimals: string;
  name: string;
  block: BigNumber; // the block the contract was deployed
  timestamp: BigNumber; // the timestamp the contract was deployed
}

export interface Pool {
  id: string;
  trust: Trust; // the trust that is the owner of this pool
  reserve: ReserveERC20; // the reserve token for this trust
  redeemable: RedeemableERC20; // the redeemable token for this trust
  poolBalanceReserve: BigNumber; // Trust.getDistributionProgress() => uint256 poolReserveBalance
  poolTokenBalance: BigNumber; // Trust.getDistributionProgress() => uint256 poolTokenBalance
  numberOfSwaps: BigNumber;
  swaps: Swap[];
  block: BigNumber; // the block the contract was deployed
  timestamp: BigNumber; // the timestamp the contract was deployed
}

export interface Swap {
  id: string;
  caller: string;
  tokenIn: string;
  tokenInSym: string;
  tokenOut: string;
  tokenOutSym: string;
  tokenAmountIn: BigNumber;
  tokenAmountOut: BigNumber;
  pool: Pool;
  userAddress: string;
  block: BigNumber; // the block the contract was deployed
  timestamp: BigNumber; // the timestamp the contract was deployed
}

export interface RedeemableERC20 {
  id: string;
  redeems: Redeem[]; // Redeem event in RedeemableERC20.sol
  treasuryAssets: TreasuryAsset[];
  minimumTier: number;
  // # redeemables: [Redeemable!]! #RedeemableERC20.getRedeemables() => returns max 8 addresses for tokens
  // #...Token interface fields
  symbol: string;
  totalSupply: BigNumber;
  decimals: number;
  name: string;
  holders: Holder[];
  block: BigNumber; // the block the contract was deployed
  timestamp: BigNumber; // the timestamp the contract was deployed
}

export interface Redeem {
  id: string;
  trust: Trust;
  caller: string; // address indexed redeemer
  treasuryAsset: TreasuryAsset;
  redeemableERC20: RedeemableERC20; // address indexed redeemable
  redeemAmount: BigNumber; // redeemAmounts[0]
  treasuryAssetAmount: BigNumber; // redeemAmounts[1]
  block: BigNumber; // the block the contract was deployed
  timestamp: BigNumber; // the timestamp the contract was deployed
}

export interface SeedERC20 {
  id: string;
  trust: Trust;
  seederFee: BigNumber; // Trust.seederFee()
  seederUnits: number; // Trust.seederUnits()
  seedFeePerUnit: BigNumber; //  = seederFee / seederUnits
  seederCooldownDuration: number; // Trust.seederCooldownDuration()
  seederUnitsAvail: BigNumber; // SeedERC20.balanceOf(this)
  seededAmount: BigNumber; // ReserveERC20.balanceOf(this)
  percentSeeded: string; // SeedERC20.seededAmount / Trust.redeemInit()
  factory: string; // Trust.seedERC20Factory()
  symbol: string;
  totalSupply: BigNumber;
  decimals: number;
  name: string;
  holders: Holder[];
  seeds: Seed[];
  unseeds: Unseed[];
  redeemSeeds: RedeemSeed[];
  block: BigNumber; // the block the contract was deployed
  timestamp: BigNumber; // the timestamp the contract was deployed
}

export interface Holder {
  id: string;
  address: string;
  balance: BigNumber;
}

export interface Seed {
  id: string;
  caller: string; // the address that was transferred to/from
  seedERC20: SeedERC20; // the seedERC20 that emitted the event
  seedAmount: BigNumber; // the reserve amount that was transferred
  seedUnits: BigNumber; // the amount of SeedERC20 that was transferred
  block: BigNumber; // the block the contract was deployed
  timestamp: BigNumber; // the timestamp the contract was deployed
}

export interface Unseed {
  id: string;
  caller: string; // the address that was transferred to/from
  seedERC20: SeedERC20; // the seedERC20 that emitted the event
  seedAmount: BigNumber; // the reserve amount that was transferred
  seedUnits: BigNumber; // the amount of SeedERC20 that was transferred
  block: BigNumber; // the block the contract was deployed
  timestamp: BigNumber; // the timestamp the contract was deployed
}

export interface TrustParticipant {
  id: string;
  user: string; // address of user
  trust: Trust; // map by address of the trust
  // Update after every Swap event from Pool, and after every Redeem event for this RedeemableERC20 (as this burns the token)
  tokenBalance: BigNumber; // RedeemableERC20.balanceOf(this.user.address)
  swaps: Swap[]; // Swaps for this.address
  // Seed events for the SeedERC20 associated with this trust, for this.address
  seeds: Seed[];
  unSeeds: Unseed[];
  // Seed redeem events for the SeedERC20 associated with this trust, for this.address
  redeemSeeds: RedeemSeed[];
  // Update after Transfer events for SeedERC20
  seedBalance: BigNumber; // SeedERC20.balanceOf(this.user.address)
  seedFeeClaimable: BigNumber; //  = SeedERC20.balanceOf(this.user.address) * SeedERC20.seedFeePerUnit
  // Reedeem events for this trust, for this.address
  redeems: Redeem[];
}

export interface RedeemSeed {
  id: string;
  caller: string; // address indexed redeemer
  seedERC20: SeedERC20; // the SeedERC20 that emitted the event
  redeemAmount: BigNumber; // redeemAmounts[0]
  reserveAmount: BigNumber; // redeemAmounts[1]
  block: BigNumber; // the block the contract was deployed
  timestamp: BigNumber; // the timestamp the contract was deployed
}

export interface TreasuryAsset {
  id: string;
  callers: TreasuryAssetCaller[];
  redeems: Redeem[];
  trust: Trust;
  address: string;
  // Update after TreasuryAsset event on RedeemableERC20
  redeemableERC20: RedeemableERC20; // the RedeemableERC20 that emitted the TreasuryAsset event for this redeemable
  // Update after TreasuryAsset event on RedeemableERC20, and after Transfer events for this token
  balance: BigNumber; // this.balanceOf(RedeemableERC20.address())
  redemptionRatio: BigNumber;
  // ...Token interface fields
  // Update after TreasuryAsset event on RedeemableERC20
  block: BigNumber; // the block the contract was deployed
  timestamp: BigNumber; // the timestamp the contract was deployed
  symbol: string;
  totalSupply: BigNumber;
  decimals: number;
  name: string;
}

export interface TreasuryAssetCaller {
  trustAddress: string;
  redeemableERC20Address: string;
  treasuryAsset: TreasuryAsset;
  id: string;
  caller: string;
  block: BigNumber;
  timestamp: BigNumber;
}
