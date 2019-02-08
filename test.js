'use strict'

const { getReleaseList, latestByChannel } = require('./index')
const repo = `doesdev/oneclick-release-test`
const fullUrlRepo = `https://github.com/doesdev/oneclick-release-test`

let secrets
try {
  secrets = require('./secrets.json')
} catch (ex) {
  const err = `Tests require secrets.json file with private repo and token`
  console.error(err)
  process.exit(1)
}
const config = { repo, token: secrets.token }
const fullUrlConfig = Object.assign({}, config, { repo: fullUrlRepo })

const start = (msg) => process.stdout.write(`${msg}\n`)

const finish = () => {
  process.stdout.clearLine()
  process.stdout.cursorTo(0)
  process.stdout.write(`All ${run} tests passed\n`)
}

let run = 0
const fail = (err) => {
  console.log('\n')
  console.error(err instanceof Error ? err : new Error(`Fail: ${err}`))
  return process.exit(1)
}

const test = (msg, isTruthyOrCompA, compB) => {
  if (compB) isTruthyOrCompA = isTruthyOrCompA === compB
  run++
  if (!isTruthyOrCompA) return fail(msg)
  process.stdout.clearLine()
  process.stdout.cursorTo(0)
  process.stdout.write(`${run} test have passed`)
  return true
}

const runTests = async () => {
  start('Starting oneclick-update tests')

  let result

  test('getReleaseList gets list of recent releases',
    Array.isArray(await getReleaseList(config))
  )

  test('getReleaseList works with private repos',
    Array.isArray(await getReleaseList(secrets))
  )

  test('getReleaseList strips github url from repo',
    Array.isArray(await getReleaseList(fullUrlConfig))
  )

  result = await latestByChannel(config)

  test('latestByChannel gets latest for all channels', (
    test(`channels are of expected type`, typeof result, 'object') &&
    test(`channel parsed from build metadata exists`, !!result['vendor-a']) &&
    test(`prerelease channel exists`, !!result.prerelease)
  ))

  finish()
}

runTests().catch(fail)
