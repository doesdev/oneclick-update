'use strict'

const { runTests, start, finish, test, testAsync } = require('mvt')
const http = require('http')
const path = require('path')
const semver = require('semver')
const qs = require('tiny-params')
const {
  getReleaseList,
  latestByChannel,
  requestHandler,
  simpleGet,
  on,
  off
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
    const useLinux = isPublic
    const usePlatformFilters = !isPublic
    const platformFilters = {
      winsub: (assets, action) => {
        return assets.find((a) => a.name.indexOf('win-sub') !== -1)
      }
    }

    if (usePlatformFilters) config.platformFilters = platformFilters

    let latest, notLatest, randomAsset

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
      notLatest = semver.inc(latest, 'patch')
      randomAsset = result[''].assets[0]

      return true
    })

    const getServerResponse = async ({
      action,
      channel,
      platform,
      version,
      redirect,
      filename,
      release,
      filetype
    }) => {
      const server = http.createServer(await requestHandler(config))
      await new Promise((resolve, reject) => server.listen(resolve))
      const port = server.address().port
      const path = [
        action,
        channel,
        platform,
        version,
        release ? 'RELEASES' : null
      ].filter((v) => v).join('/')
      let qEls = [
        filename ? `filename=${filename}` : null,
        filetype ? `filetype=${filetype}` : null
      ].filter((v) => v)
      const q = qEls.length ? `?${qEls.join('&')}` : ''
      const url = `http://localhost:${port}/${path}${q}`
      const result = await simpleGet(url, { redirect })

      server.unref()

      return result
    }

    const testPlatformDownload = async (
      platform,
      ext,
      expectNoContent,
      forceExt
    ) => {
      const host = isPublic ? 'github.com' : 'amazonaws.com'
      const action = 'download'
      const redirect = false
      const filetype = forceExt ? ext : null
      const args = { action, platform, redirect, filetype }
      const result = await getServerResponse(args)
      const location = result.headers.location

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
        (new URL(location)).hostname.slice(-host.length),
        host
      )

      let resultFile
      if (isPublic) {
        resultFile = location.slice(location.lastIndexOf('/') + 1)
      } else {
        const meta = qs(location)['response-content-disposition']
        resultFile = meta.split('filename=')[1]
      }

      test(`[${type}] download for ${platform} is expected filetype`,
        path.extname(resultFile).slice(1),
        ext
      )

      return true
    }

    let onResult
    on('download', (r) => { onResult = r })

    await testAsync(`[${type}] requestHandler download/win32`, () => {
      return testPlatformDownload('win32', 'exe')
    })

    test(`[${type}] on('download') fires`, onResult.platform, 'win32')
    off('download')

    await testAsync(`[${type}] requestHandler download/darwin`, () => {
      return testPlatformDownload('darwin', 'dmg')
    })

    if (usePlatformFilters) {
      await testAsync(`[${type}] platformFilters download/winsub`, () => {
        return testPlatformDownload('winsub', 'exe')
      })
    }

    if (useLinux) {
      await testAsync(`[${type}] requestHandler download/linux`, () => {
        return testPlatformDownload('linux', 'deb')
      })

      await testAsync(`[${type}] requestHandler download/linux as rpm`, () => {
        return testPlatformDownload('linux', 'rpm', null, true)
      })
    }

    await testAsync(`[${type}] download fails with no content`, () => {
      return testPlatformDownload('notaplatform', null, true)
    })

    await testAsync(`[${type}] download specific file works`, async () => {
      const filename = randomAsset.name
      const args = { action: 'download', filename, redirect: false }
      const result = await getServerResponse(args)
      const location = result.headers.location
      let resultFile

      if (isPublic) {
        resultFile = location.slice(location.lastIndexOf('/') + 1)
      } else {
        const meta = qs(location)['response-content-disposition']
        resultFile = meta.split('filename=')[1]
      }

      return test(`[${type}] redirect url points to filename`,
        filename,
        resultFile
      )
    })

    const testPlatformUpdate = async (
      platform,
      expectNoContent,
      version,
      urlIncludes
    ) => {
      const { serverUrl } = config
      const host = isPublic ? 'github.com' : (new URL(serverUrl)).hostname
      const args = { action: 'update', platform, version }
      const result = await getServerResponse(args)
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

      if (urlIncludes) {
        test(`[${type}] update for ${platform} url includes expected string`,
          data.url.indexOf(urlIncludes) !== -1,
          undefined,
          { url: data.url, shouldInclude: urlIncludes }
        )
      }

      test(`[${type}] update for ${platform} contains expected url`,
        (new URL(data.url)).hostname.slice(-host.length),
        host
      )

      return true
    }

    await testAsync(`[${type}] requestHandler update/win32`, () => {
      const shouldInclude = isPublic ? '.exe' : '/win32'
      return testPlatformUpdate('win32', null, null, shouldInclude)
    })

    await testAsync(`[${type}] requestHandler update/darwin`, () => {
      const shouldInclude = isPublic ? '.zip' : '/darwin'
      return testPlatformUpdate('darwin', null, null, shouldInclude)
    })

    if (useLinux) {
      await testAsync(`[${type}] requestHandler update/darwin`, () => {
        const shouldInclude = isPublic ? '.deb' : '/linux'
        return testPlatformUpdate('linux', null, null, shouldInclude)
      })
    }

    await testAsync(`[${type}] update returns no content for bad platform`, () => {
      return testPlatformUpdate('notaplatform', true)
    })

    await testAsync(`[${type}] update returns no content for latest version`, () => {
      return testPlatformUpdate('win32', true, latest)
    })

    await testAsync(`[${type}] update works for non-latest version`, () => {
      return testPlatformUpdate('win32', false, notLatest)
    })

    await testAsync(`[${type}] RELEASES gets expected data`, async () => {
      const { serverUrl } = config
      const expectHost = isPublic ? 'github.com' : (new URL(serverUrl)).hostname
      const args = {
        action: 'update',
        platform: 'win32',
        version: notLatest,
        redirect: true,
        release: true
      }
      const { data } = await getServerResponse(args)
      const firstLine = data.split('\n')[0]
      const split = firstLine.split(' ')
      const [hash, url, size] = split
      const host = (new URL(url)).hostname.slice(-expectHost.length)

      test(`[${type}] RELEASES has expected sections`, split.length, 3)

      test(`[${type}] RELEASES hash is expected length`, hash.length, 40)

      test(`[${type}] RELEASES url is as expected`, host, expectHost)

      test(`[${type}] RELEASES size is a number`, !Number.isNaN(+size))

      return true
    })
  }

  finish()
})
