import { Server } from 'prool'
import * as TestContainers from 'prool/testcontainers'

const tempoImage = 'ghcr.io/tempoxyz/tempo:sha-3da8342'

export async function startTempoLocalnet() {
  const localnet = Server.create({
    instance: TestContainers.Instance.tempo({
      blockTime: '2ms',
      image: tempoImage,
      port: 8545,
    }),
  })

  await localnet.start()
  const address = localnet.address()
  if (!address) {
    await localnet.stop()
    throw new Error('Tempo Docker localnet did not start.')
  }

  return {
    localnet,
    rpcUrl: `http://127.0.0.1:${address.port}/1`,
  }
}
