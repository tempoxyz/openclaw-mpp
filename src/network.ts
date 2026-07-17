import { tempo, tempoModerato } from 'viem/tempo/chains'

export const tempoNetworks = {
  mainnet: tempo,
  testnet: tempoModerato,
} as const

export type TempoNetwork = keyof typeof tempoNetworks

export const tempoChains = [tempoNetworks.mainnet, tempoNetworks.testnet] as const

export function parseTempoNetwork(value: unknown): TempoNetwork | undefined {
  if (value === undefined) return undefined
  if (value === 'mainnet' || value === 'testnet') return value
  throw new Error('Network must be mainnet or testnet.')
}
