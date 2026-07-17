import { readFile, writeFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const path = 'openclaw.plugin.json'
const manifest = JSON.parse(await readFile(path, 'utf8'))

if (process.argv.includes('--check')) {
  if (manifest.version !== packageJson.version)
    throw new Error('Package and plugin manifest versions do not match.')
} else {
  manifest.version = packageJson.version
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
}
