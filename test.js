'use strict'

const http = require('http')
const {
  getReleaseList,
  latestByChannel,
  requestHandler,
  simpleGet
} = require('./index')
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
const publicConfig = { repo, token: secrets.token }
const fullUrlConfig = (c) => Object.assign({}, c, { repo: fullUrlRepo })

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
  run++

  if (compB !== undefined && isTruthyOrCompA !== compB) {
    msg += `\n${isTruthyOrCompA} !== ${compB}`
    isTruthyOrCompA = false
  }

  if (!isTruthyOrCompA) return fail(msg)

  process.stdout.clearLine()
  process.stdout.cursorTo(0)
  process.stdout.write(`${run} test have passed`)
  return true
}

const testAsync = async (msg, promise) => {
  try {
    test(msg, await promise())
  } catch (ex) {
    return fail(ex)
  }
}

const runTests = async () => {
  start('Starting oneclick-update tests')

  let result

  for (const type of ['public', 'private']) {
    const isPublic = type === 'public'
    const config = isPublic ? publicConfig : secrets

    test(`[${type}] getReleaseList gets list of recent releases`,
      Array.isArray(await getReleaseList(config))
    )

    test(`[${type}] getReleaseList strips github url from repo`,
      Array.isArray(await getReleaseList(fullUrlConfig(config)))
    )

    result = await latestByChannel(config)

    test(`[${type}] latestByChannel gets latest for all channels`, (
      test(`[${type}] channels are of expected type`,
        typeof result,
        'object'
      ) &&
      test(`[${type}] channel parsed from build metadata exists`,
        !isPublic || !!result['vendor-a']
      ) &&
      test(`[${type}] prerelease channel exists`,
        !isPublic || !!result.prerelease
      )
    ))

    await testAsync(`[${type}] requestHandler download/win32 works`, async () => {
      const server = http.createServer(await requestHandler(config))
      await new Promise((resolve, reject) => server.listen(resolve))
      const port = server.address().port
      const url = `http://localhost:${port}/download/win32`
      const result = await simpleGet(url, { redirect: false })
      server.unref()

      test(`[${type}] download for win32 redirects with 302`,
        result.statusCode,
        302
      )

      const expect = type === 'public' ? 'github.com' : 'amazonaws.com'
      test(`[${type}] download for win32 redirects to ${expect}`,
        (new URL(result.headers.location)).hostname.slice(-expect.length),
        expect
      )

      return true
    })

    await testAsync(`[${type}] requestHandler download/darwin works`, async () => {
      const server = http.createServer(await requestHandler(config))
      await new Promise((resolve, reject) => server.listen(resolve))
      const port = server.address().port
      const url = `http://localhost:${port}/download/darwin`
      const result = await simpleGet(url, { redirect: false })
      server.unref()

      test(`[${type}] download for win32 redirects with 302`,
        result.statusCode,
        302
      )

      const expect = type === 'public' ? 'github.com' : 'amazonaws.com'
      test(`[${type}] download for win32 redirects to ${expect}`,
        (new URL(result.headers.location)).hostname.slice(-expect.length),
        expect
      )

      return true
    })
  }

  finish()
}

runTests().catch(fail)
