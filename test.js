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

  for (const type of ['public', 'private']) {
    const isPublic = type === 'public'
    const config = isPublic ? publicConfig : secrets
    const metaChannel = isPublic ? 'vendor-a' : null
    const preChannel = isPublic ? 'prerelease' : null

    test(`[${type}] getReleaseList gets list of recent releases`,
      Array.isArray(await getReleaseList(config))
    )

    test(`[${type}] getReleaseList strips github url from repo`,
      Array.isArray(await getReleaseList(fullUrlConfig(config)))
    )

    await testAsync(`[${type}] latestByChannel`, async () => {
      const result = await latestByChannel(config)

      test(`[${type}] channels are of expected type`, typeof result, 'object')

      if (metaChannel) {
        test(`[${type}] channel parsed from build metadata exists`,
          result[metaChannel].channel,
          metaChannel
        )
      }

      if (preChannel) {
        test(`[${type}] prerelease channel exists`,
          result[preChannel].channel,
          preChannel
        )
      }

      return true
    })

    const testPlatformDownload = async (platform, expectNoContent) => {
      const host = isPublic ? 'github.com' : 'amazonaws.com'

      const server = http.createServer(await requestHandler(config))
      await new Promise((resolve, reject) => server.listen(resolve))
      const port = server.address().port
      const url = `http://localhost:${port}/download/${platform}`
      const result = await simpleGet(url, { redirect: false })
      server.unref()

      if (expectNoContent) {
        test(`[${type}] expecting no content for ${platform}`,
          result.statusCode,
          204
        )

        return true
      }

      test(`[${type}] download for ${platform} redirects with 302`,
        result.statusCode,
        302
      )

      test(`[${type}] download for ${platform} redirects to ${host}`,
        (new URL(result.headers.location)).hostname.slice(-host.length),
        host
      )

      return true
    }

    await testAsync(`[${type}] requestHandler download/win32`, () => {
      return testPlatformDownload('win32')
    })

    await testAsync(`[${type}] requestHandler download/darwin`, () => {
      return testPlatformDownload('darwin')
    })

    await testAsync(`[${type}] requestHandler fails with no content`, () => {
      return testPlatformDownload('notaplatform', true)
    })
  }

  finish()
}

runTests().catch(fail)
