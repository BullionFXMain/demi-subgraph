export const QUERY = `
    {
    trustFactories{
      id
      trustCount
      trusts {
        id
        creator
        deployBlock
        deployTimestamp
        factory
        notices {
          id
        }
        trustParticipants {
          id
        }
        distributionProgress {
          id
        }
        contracts {
          id
        }
      }
    }
  }
`;

export const NOTICE_QUERY = `
  {
    notices{
      sender
      data
      trust{
        id
      }
    }
  }`;

export function getTrust(trust: string): string {
  return `
    {
      trust(id:"${trust}"){
        notices{
          id
        }
      }
    }
  `;
}

export function getFactories(factory: string): string {
  return `
    {
      trustFactory(id:"${factory}"){
        balancerFactory
        crpFactory
        redeemableERC20Factory
        seedERC20Factory
        bPoolFeeEscrow
      }
    }
  `;
}

export function getContracts(contract: string): string {
  return `
    {
      contract(id:"${contract}"){
        crp {
          id
        }
        reserveERC20 {
          id
          name
          symbol
          decimals
          totalSupply
        }
        redeemableERC20 {
          id
          name
          symbol
          decimals
          totalSupply
        }
        seeder {
          id
          name
          symbol
          decimals
          totalSupply
        }
        tier
        pool {
          id
        }
      }
    }
  `;
}
