'use strict'

const userAgent = `oneclick-update`
const { get: httpGet } = require('http')
const { get: httpsGet } = require('https')
const semver = require('semver')
const repos = {}

const {
  GITHUB_ACCOUNT,
  GITHUB_PROJECT,
  GITHUB_REPO,
  GITHUB_OAUTH_TOKEN,
  SERVER_URL
} = process.env

const contentType = {
  ghJson: `application/vnd.github.v3+json`,
  octet: `application/octet-stream`
}

const ghHeader = (token, accept = `ghJson`) => {
  const header = { 'User-Agent': userAgent, Accept: contentType[accept] }

  if (token) header.Authorization = `token ${token}`

  return header
}

const apiBaseUrl = (repo) => `https://api.github.com/repos/${repo}`

class GithubApiError extends Error {
  constructor (message, res) {
    super(message)
    if (res.error) this.serverError = res.error
    this.statusCode = res.statusCode
    this.body = (res.data || {}).message || res.data
  }
}

const simpleGet = (url, opts = {}) => new Promise((resolve, reject) => {
  const getter = url.indexOf('http://') ? httpsGet : httpGet
  const { redirect = true } = opts

  getter(url, opts, (res) => {
    const location = res.headers.location

    if (res.statusCode === 302 && location) {
      if (redirect === false) return resolve(res)
      return simpleGet(location, { redirect }).then(resolve)
    }

    if (opts.noBody) return resolve(res)

    const isJson = (res.headers['content-type'] || '').indexOf('json') !== -1
    if (isJson) res.setEncoding('utf8')

    let data = ''
    res.on('data', (d) => { data += d })
    res.on('end', () => {
      if (isJson) {
        try {
          data = JSON.parse(data)
        } catch (ex) {
          res.error = ex
        }
      }
      res.data = data
      resolve(res)
    })
    res.on('error', (error) => resolve({ statusCode: 500, error }))
  })
})

const isPrivate = async (repo, token) => {
  const url = apiBaseUrl(repo)

  const res = await simpleGet(url, { headers: ghHeader() })
  if (res.statusCode === 200) return { private: false }

  if (token) {
    const headers = ghHeader(token)
    const privRes = await simpleGet(url, { headers })
    if (privRes.statusCode === 200) return { private: true }
  }

  throw new GithubApiError(`Repo not found on Github: ${repo}`, res)
}

const initCacheForRepo = (repo) => {
  repo.resetCache = () => initCacheForRepo(repo)
  repo.cacheByPath = { channel: {}, platform: {}, serverUrl: {} }
}

const getConfig = async (configIn = {}) => {
  if (repos[configIn.repos]) return configIn

  const config = Object.assign({}, configIn)
  config.serverUrl = (config.serverUrl || SERVER_URL || '').trim()
  config.token = (config.token || GITHUB_OAUTH_TOKEN || '').trim()
  config.account = (config.account || GITHUB_ACCOUNT || '').trim()
  config.project = (config.project || GITHUB_PROJECT || '').trim()
  config.repo = (config.repo || GITHUB_REPO || '').trim()
  config.platformFilters = config.platformFilters || {}

  if (!config.repo) {
    if (!(config.account && config.project)) throw new Error(`Repo is required`)
    config.repo = `${config.account}/${config.project}`
  }

  if (config.repo.indexOf('github.com/') !== -1) {
    config.repo = config.repo.replace(/.*github.com\//, '')
  }

  if (repos[config.repo]) return config

  repos[config.repo] = await isPrivate(config.repo, config.token)
  initCacheForRepo(repos[config.repo])

  if (repos[config.repo].private && !config.serverUrl) {
    let msg = `\nFor private repos we recommend setting serverUrl / SERVER_URL\n`
    msg += ` - If not set we will try to extract that info from each request\n`
    msg += ` - That isn't guaranteed to produce the correct return URL\n`
    msg += ` - That also adds overhead to each request\n`
    console.log(msg)
  }

  return config
}

const getReleaseList = async (config) => {
  try {
    config = await getConfig(config)
  } catch (ex) {
    return Promise.reject(ex)
  }

  const { repo, token } = config
  const rlsUrl = `${apiBaseUrl(repo)}/releases`
  const headers = ghHeader(token)
  const { data: releases, error } = await simpleGet(rlsUrl, { headers })

  if (error) return Promise.reject(error)

  repos[repo].releases = releases

  return Promise.resolve(releases)
}

const latestByChannel = async (config) => {
  try {
    config = await getConfig(config)
  } catch (ex) {
    return Promise.reject(ex)
  }

  const { repo } = config

  const releases = repos[repo].releases || await getReleaseList(config)
  const channels = repos[repo].channels = repos[repo].channels || {}

  const setLatestForChannel = (release, channel) => {
    release.channel = channel = channel.toLowerCase()
    const currentTag = (channels[channel] || {}).tag_name
    if (currentTag && semver.gt(currentTag, release.tag_name)) return
    channels[channel] = release
  }

  releases.forEach((r) => {
    const { tag_name: tag } = r
    const cleanTag = semver.valid(tag)

    if (!cleanTag) return

    const tagMeta = tag.indexOf('+') >= 0 ? tag.slice(tag.indexOf('+') + 1) : ''
    const tagPreAry = semver.prerelease(cleanTag) || []
    const tagPre = tagPreAry.find((p) => Number.isNaN(+p))
    const rlsPre = r.prerelease ? `prerelease` : null

    const channel = [tagMeta, tagPre, rlsPre].filter((c) => c).join('/')
    setLatestForChannel(r, channel)
  })

  return channels
}

const guessPlatform = (ua = '') => {
  const uaPlatform = ((ua.match(/\((.+?)\)/) || [])[1] || '').toLowerCase()

  if (uaPlatform && uaPlatform.indexOf('windows') !== -1) return 'win32'
  if (uaPlatform && uaPlatform.indexOf('mac') !== -1) return 'darwin'

  return null
}

const getChannel = (repo, channels, pathLower) => {
  const cached = repo.cacheByPath.channel[pathLower]
  if (cached) return cached

  let channel
  Object.entries(channels).forEach(([channelName, release]) => {
    if (!channelName || pathLower.indexOf(channelName) === -1) return
    if (!channel) return (channel = release)

    const slashLen = (name) => name.split('/').length
    const useCurrent = slashLen(channel.channel) > slashLen(channelName)
    channel = useCurrent ? channel : release
  })

  channel = channel || channels['']
  repo.cacheByPath.channel[pathLower] = channel

  return channel
}

const getPlatform = (repo, pathLower, channel, headers) => {
  const cached = repo.cacheByPath.platform[pathLower]
  if (cached) return cached

  let tmpPath = pathLower.replace(/^\/download|update/, '')
  if (channel.channel) tmpPath = tmpPath.replace(`/${channel.channel}`, '')

  const pathPlatform = tmpPath.split('/')[1]
  const platform = pathPlatform || guessPlatform(headers['user-agent'])

  if (pathPlatform) repo.cacheByPath.platform[pathLower] = platform

  return platform
}

const getServerUrl = (repo, pathLower, req) => {
  const cached = repo.cacheByPath.serverUrl[pathLower]
  if (cached) return cached

  const { socket } = req
  const unsecure = socket.localPort === 80 || socket.remotePort === 80

  if (!req.headers.host) return

  const serverUrl = `${unsecure ? 'http' : 'https'}://${req.headers.host}`
  repo.cacheByPath.serverUrl[pathLower] = serverUrl

  return serverUrl
}

const filterByExt = (assets, ext) => {
  ext = ext.charAt(0) === '.' ? ext : `.${ext}`
  const extLen = ext.length
  return assets.filter((a) => a.name.indexOf(ext) === a.name.length - extLen)
}

const firstForArch = (assets, arch) => {
  assets.sort((a, b) => {
    a = a.name.indexOf('64') === -1 ? -1 : 1
    b = b.name.indexOf('64') === -1 ? -1 : 1
    return a - b
  })

  return arch === 'x64' ? assets[assets.length - 1] : assets[0]
}

const platformFilters = {
  win32: (assets, action = 'download', arch, ext) => {
    const download = () => {
      ext = ext || 'exe'
      if ((assets = filterByExt(assets, ext)).length < 2) return assets[0]
      return firstForArch(assets, arch)
    }

    const release = () => {
      assets = assets.filter((a) => !a.name.indexOf('RELEASES'))
      if ((assets = filterByExt(assets, ext)).length < 2) return assets[0]
      return firstForArch(assets, arch)
    }

    const actions = { download, update: download, release }

    return actions[action] ? actions[action]() : null
  },
  darwin: (assets, action = 'download', arch, ext = 'dmg') => {
    const download = () => {
      let asset
      if (ext === 'dmg' && (asset = filterByExt(assets, 'dmg')[0])) return asset

      if ((assets = filterByExt(assets, 'zip')).length < 2) return assets[1]

      assets = assets.filter((a) => a.name.match(/mac|osx|darwin/i))

      if (assets.length < 2) return assets[0]

      return assets.filter((a) => a.name.indexOf('symbols') === -1)[0]
    }

    const update = () => {
      ext = 'zip'
      return download()
    }

    const actions = { download, update }

    return actions[action] ? actions[action]() : null
  }
}

const getPlatformAsset = (config, repo, channel, platform, action, arch) => {
  // const cached = repo.cacheByPath.platformAsset[pathLower]
  const assets = channel.assets.slice(0)
  let asset

  if (!config.platformFilters[platform] && !platformFilters[platform]) return

  if (config.platformFilters && config.platformFilters[platform]) {
    asset = config.platformFilters[platform](assets, action, arch)
  }

  asset = asset || platformFilters[platform](assets, action, arch)

  return asset
}

const requestHandler = async (config) => {
  try {
    config = await getConfig(config)
  } catch (ex) {
    return Promise.reject(ex)
  }

  const channels = await latestByChannel(config)
  const repo = repos[config.repo]

  let { serverUrl } = config

  const noContent = (res) => {
    res.statusCode = 204
    return res.end()
  }

  return async (req, res) => {
    const { headers } = req
    const [path] = req.url.split('?')
    const pathLower = path.toLowerCase()

    const finish = (location) => {
      if (location) res.writeHead(302, { Location: location })
      return res.end()
    }

    if (repo.private && !serverUrl) {
      serverUrl = getServerUrl(repo, pathLower, req)

      if (!serverUrl) {
        const err = new Error('Unable to determine serverUrl for private repo')
        console.error(err)

        return noContent(res)
      }
    }

    const isUpdate = !path.indexOf('/update')
    const isRelease = path.indexOf('/RELEASES') !== -1
    const action = isUpdate ? 'update' : (isRelease ? 'release' : 'download')

    const channel = getChannel(repo, channels, pathLower)

    if (!channel) return noContent(res)

    const platform = getPlatform(repo, pathLower, channel, headers)

    if (!platform) return noContent(res)

    const asset = getPlatformAsset(config, repo, channel, platform, action)

    if (!asset) return noContent(res)

    if (action === 'download') {
      if (!repo.private) return finish(asset.browser_download_url)

      const headers = ghHeader(config.token, 'octet')
      const privRes = await simpleGet(asset.url, { headers, redirect: false })

      return finish(privRes.headers.location)
    }

    res.setHeader('Content-Type', 'application/json')
    const tmpObj = {
      action,
      serverUrl,
      channel: channel.channel,
      tag: channel.tag_name,
      platform,
      asset
    }
    res.end(JSON.stringify(tmpObj, null, 2))

    /* ROUTES
      /
      /download[/channel]
      /download[/channel]/:platform
      /update[/channel]/:platform/:version
      /update[/channel]/win32/:version/RELEASES
      /changelog[/channel]/:version
    */
  }
}

module.exports = {
  getReleaseList,
  latestByChannel,
  requestHandler,
  simpleGet
}
