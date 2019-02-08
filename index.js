'use strict'

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

const hdrUa = { 'User-Agent': `oneclick-update` }
const hdrGhJson = { Accept: `application/vnd.github.v3+json` }
const uaJsonHeader = Object.assign({}, hdrUa, hdrGhJson)

const setUaJson = (h) => Object.assign({}, h, hdrUa, hdrGhJson)
const getAuthHdr = (token) => (token ? { Authorization: `token ${token}` } : {})
const getAuthHdrJson = (token) => setUaJson(getAuthHdr(token))

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
  const { redirect } = opts
  httpsGet(url, opts, (res) => {
    const location = res.headers.location

    if (res.statusCode === 302 && redirect !== 'manual' && location) {
      return simpleGet(location, { redirect }).then(resolve)
    }

    if (opts.noBody) return resolve(res)

    const isJson = res.headers['content-type'].indexOf('json') !== -1
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

  const res = await simpleGet(url, { headers: uaJsonHeader })
  if (res.statusCode === 200) return { private: false }

  if (token) {
    const headers = getAuthHdrJson(token)
    const privRes = await simpleGet(url, { headers })
    if (privRes.statusCode === 200) return { private: true }
  }

  throw new GithubApiError(`Repo not found on Github: ${repo}`, res)
}

const getConfig = async (configIn = {}) => {
  if (repos[configIn.repos]) return configIn

  const config = Object.assign({}, configIn)
  config.serverUrl = (config.serverUrl || SERVER_URL || '').trim()
  config.token = (config.token || GITHUB_OAUTH_TOKEN || '').trim()
  config.account = (config.account || GITHUB_ACCOUNT || '').trim()
  config.project = (config.project || GITHUB_PROJECT || '').trim()
  config.repo = (config.repo || GITHUB_REPO || '').trim()

  if (!config.repo) {
    if (!(config.account && config.project)) throw new Error(`Repo is required`)
    config.repo = `${config.account}/${config.project}`
  }

  if (config.repo.indexOf('github.com/') !== -1) {
    config.repo = config.repo.replace(/.*github.com\//, '')
  }

  if (repos[config.repo]) return config

  repos[config.repo] = await isPrivate(config.repo, config.token)

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
  const headers = getAuthHdrJson(token)
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
    channel = channel.toLowerCase()
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

const requestHandler = async (config) => {
  try {
    config = await getConfig(config)
  } catch (ex) {
    return Promise.reject(ex)
  }

  const channels = await latestByChannel(config)
  const { repo } = config

  let { serverUrl } = config

  return (req, res) => {
    const path = req.url.slice(1)

    if (repo.private && !serverUrl) {
      const host = req.headers.host
      const { socket } = req
      const unsecure = socket.localPort === 80 || socket.remotePort === 80

      if (!host) {
        const err = new Error('Unable to determine serverUrl for private repo')
        console.error(err)

        req.statusCode = 204
        return req.end()
      }

      serverUrl = `${unsecure ? 'http' : 'https'}://${host}`
    }

    const isUpdate = !path.indexOf('update')
    console.log(isUpdate, serverUrl, channels.length)
  }
}

module.exports = { getReleaseList, latestByChannel, requestHandler }
