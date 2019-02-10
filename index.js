'use strict'

const repos = require('jao').repos = {}
const { getConfig, getServerUrl } = require('./lib/config')
const { getChannel, latestByChannel } = require('./lib/channels')
const { getPlatform, getPlatformAsset } = require('./lib/platforms')

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

  return (req, res) => {
    const { headers } = req
    const [path] = req.url.split('?')
    const pathLower = path.toLowerCase()

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
    */
  }
}

module.exports = requestHandler
