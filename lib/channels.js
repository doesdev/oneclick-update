'use strict'

const semver = require('semver')
const { repos } = require('jao')
const { getReleaseList } = require('./gh-api')

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

const latestByChannel = async (config) => {
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

module.exports = { latestByChannel, getChannel }
