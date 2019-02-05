'use strict'

const { getReleaseList } = require('./index')
const repo = `atom/atom`
const config = { repo }

let secrets
try {
  secrets = require('./secrets.json')
} catch (ex) {
  const err = `Tests require secrets.json file with private repo and token`
  console.error(err)
  process.exit(1)
}

const start = (msg) => process.stdout.write(`${msg}\n`)

const finish = () => {
  process.stdout.clearLine()
  process.stdout.cursorTo(0)
  process.stdout.write(`All ${run} tests passed\n`)
}

let run = 0
const fail = (msg) => {
  console.log('\n')
  console.error(new Error(`Fail - ${msg}`))
  return process.exit(1)
}

const test = (msg, isTruthyOrCompA, compB) => {
  if (compB) isTruthyOrCompA = isTruthyOrCompA === compB
  run++
  if (!isTruthyOrCompA) return fail(msg)
  process.stdout.clearLine()
  process.stdout.cursorTo(0)
  process.stdout.write(`${run} test have passed`)
}

const runTests = async () => {
  start('Starting oneclick-update tests')

  let result

  result = await getReleaseList(config)
  test('getReleaseList gets list of recent releases', Array.isArray(result))

  result = await getReleaseList(secrets)
  test('getReleaseList works with private repos', Array.isArray(result))

  finish()
}

runTests()
