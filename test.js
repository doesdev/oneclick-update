'use strict'

const { getLatestRelease } = require('./index')
const repo = `doesdev/scrud`
const config = { repo }

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

  test('getLatestRelease gets list of releases', await getLatestRelease(config))

  finish()
}

runTests()
