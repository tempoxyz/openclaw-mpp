import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry'
import { getWalletStatus, normalizeConfig, setupWallet } from './mpp.js'
import { parseTempoNetwork } from './network.js'
import { resolveSetupPolicy } from './setup.js'

type SetupOptions = {
  deposit: boolean
  expires?: string
  limit?: string
  network: string
}
type StatusOptions = {
  network?: string
}

export function registerCli(api: OpenClawPluginApi) {
  api.registerCli(
    ({ program }) => {
      const mpp = program.command('mpp').description('Configure MPP payments')

      mpp
        .command('status')
        .description('Show MPP wallet status')
        .option('--network <network>', 'Tempo network')
        .action(async ({ network }: StatusOptions) =>
          printStatus(
            await getWalletStatus(
              normalizeConfig(api.pluginConfig),
              parseTempoNetwork(network),
            ),
          ),
        )

      mpp
        .command('setup')
        .description('Connect Tempo Wallet for MPP payments')
        .option('--expires <duration>', 'Access key lifetime')
        .option('--limit <token=amount>', 'Access key spending limit')
        .option('--network <network>', 'Tempo network', 'mainnet')
        .option('--no-deposit', 'Skip the Tempo Wallet funding prompt')
        .action(async (options: SetupOptions) => {
          const config = normalizeConfig(api.pluginConfig)
          const status = await setupWallet(config, {
            ...resolveSetupPolicy({
              expires: options.expires,
              limit: options.limit,
              network: parseTempoNetwork(options.network),
              showDeposit: options.deposit,
            }),
            open(url) {
              console.log(`\nOpen Tempo Wallet to approve this access key:\n\n${url}\n`)
            },
          })
          printStatus(status)
          if (status.source === 'wallet')
            console.log('Restart a running gateway to load the new access key.')
        })
    },
    {
      descriptors: [
        {
          name: 'mpp',
          description: 'Configure MPP payments',
          hasSubcommands: true,
        },
      ],
    },
  )
}

function printStatus(status: Awaited<ReturnType<typeof getWalletStatus>>) {
  console.log(status.message)
  if (status.account) console.log(`Account: ${status.account}`)
  if (status.accessKey) console.log(`Access key: ${status.accessKey}`)
}
