'use strict'

const { runTests, start, finish, test, testAsync } = require('mvt')
const http = require('http')
const semver = require('semver')
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

runTests(async () => {
  start('Starting oneclick-update tests')

  for (const type of ['public', 'private']) {
    const isPublic = type === 'public'
    const config = isPublic ? publicConfig : secrets
    const metaChannel = isPublic ? 'vendor-a' : null
    const preChannel = isPublic ? 'prerelease' : null

    let latest

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

      latest = result[''].tag_name

      return true
    })

    const getServerResponse = async (
      action,
      channel,
      platform,
      version,
      redirect
    ) => {
      const server = http.createServer(await requestHandler(config))
      await new Promise((resolve, reject) => server.listen(resolve))
      const port = server.address().port
      const path = [action, channel, platform, version].filter((v) => v).join('/')
      const url = `http://localhost:${port}/${path}`
      const result = await simpleGet(url, { redirect })

      server.unref()

      return result
    }

    const testPlatformDownload = async (platform, expectNoContent) => {
      const host = isPublic ? 'github.com' : 'amazonaws.com'
      const action = 'download'
      const result = await getServerResponse(action, null, platform, null, false)

      if (expectNoContent) {
        return test(`[${type}] download expecting no content for ${platform}`,
          result.statusCode,
          204
        )
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

    await testAsync(`[${type}] download fails with no content`, () => {
      return testPlatformDownload('notaplatform', true)
    })

    const testPlatformUpdate = async (platform, expectNoContent, version) => {
      const { serverUrl } = config
      const host = isPublic ? 'github.com' : (new URL(serverUrl)).hostname
      const result = await getServerResponse('update', null, platform, version)
      const { data } = result

      if (expectNoContent) {
        return test(`[${type}] update expecting no content for ${platform}`,
          result.statusCode,
          204
        )
      }

      test(`[${type}] update for ${platform} contains name`,
        typeof data.name,
        'string'
      )

      test(`[${type}] update for ${platform} contains expected url`,
        (new URL(data.url)).hostname.slice(-host.length),
        host
      )

      return true
    }

    await testAsync(`[${type}] requestHandler update/win32`, () => {
      return testPlatformUpdate('win32')
    })

    await testAsync(`[${type}] requestHandler update/darwin`, () => {
      return testPlatformUpdate('darwin')
    })

    await testAsync(`[${type}] update returns no content for bad platform`, () => {
      return testPlatformUpdate('notaplatform', true)
    })

    await testAsync(`[${type}] update returns no content for latest version`, () => {
      return testPlatformUpdate('win32', true, latest)
    })

    await testAsync(`[${type}] update works for non-latest version`, () => {
      return testPlatformUpdate('win32', false, semver.inc(latest, 'patch'))
    })
  }

  finish()
})
