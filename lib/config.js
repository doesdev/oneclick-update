'use strict'

const { repos } = require('jao')
const { isPrivate } = require('./gh-api')

const {
  GITHUB_ACCOUNT,
  GITHUB_PROJECT,
  GITHUB_REPO,
  GITHUB_OAUTH_TOKEN,
  SERVER_URL
} = process.env

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

module.exports = { getConfig, getServerUrl }
