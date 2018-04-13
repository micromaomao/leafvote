#!/usr/bin/env node

const args = require('./boom.args')

if (!Number.isSafeInteger(args.threads) || args.threads <= 0 || !Array.isArray(args.voteBias) || args.voteBias.length === 0 || !Array.isArray(args.secrets) || args.secrets.length === 0) {
  process.stderr.write('Invalid argument. See ./boom.args.js')
  process.exit(1)
}

const WebSocket = require('ws')
const socketUrl = 'wss://leafvote.mww.moe/'
const readline = require('readline')

function initThreadQueues () {
  let threadQueues = []
  for (let i = 0; i < args.threads; i ++) {
    threadQueues[i] = new Set()
  }
  for (let i = 0; i < args.secrets.length; i ++) {
    threadQueues[i % threadQueues.length].add(args.secrets[i])
  }
  return threadQueues
}

let threadQueues = initThreadQueues()

function randomWait (maxMs = 100) {
  return new Promise((resolve, reject) => { setTimeout(() => resolve(), Math.ceil(Math.random() * maxMs)) })
}

async function initThread (queue) {
  await randomWait(2000)
  for (let secret of queue.values()) {
    await randomWait(500)
    await doVote(secret)
    queue.delete(secret)
  }
  return null
}

let activeConnections = 0

function doVote (secret) {
  return new Promise((resolve, reject) => {
    let socket = new WebSocket(socketUrl)
    let closed = false
    socket.on('open', () => {
      if (closed) return
      activeConnections ++
      try {
        socket.send(JSON.stringify({
          type: 'login',
          secret,
          role: 'voter',
          _id: 'catch'
        }))
      } catch (e) {
        close()
        reject(e)
      }
    })
    socket.on('message', data => {
      if (closed) return
      try {
        if (typeof data !== 'string') throw new Error('String expected from message event.')
        let obj = JSON.parse(data)
        if (obj._id === 'catch') {
          if (obj.error) {
            throw new Error(obj.error)
          }
          return
        }
        if (obj._id === null) {
          if (obj.type === 'voterPush') {
            return void gotVoterPush(obj.polls)
          }
          throw new Error(`Invalid message ${JSON.stringify(obj)}`)
        }
        throw new Error(`Invalid message ${JSON.stringify(obj)}`)
      } catch (e) {
        close()
        reject(e)
      }
    })
    socket.on('error', err => {
      if (closed) return
      close()
      reject(err)
    })
    socket.on('close', err => {
      if (closed) return
      closed = true
      activeConnections --
    })
    function close () {
      if (closed) return
      closed = true
      activeConnections --
      try {
        socket.close(1000)
      } catch (e) {}
    }
    let pendingVoteIndex = decideWhatToVote()
    let closeConnectionTimeout = null
    function gotVoterPush (polls) {
      if (closed) return
      try {
        let allVoted = true
        for (let poll of polls) {
          if (poll.options.length !== args.voteBias.length) throw new Error(`args.voterBias.length !== ${poll.options.length}`)
          if (!poll.active) continue
          if (!poll.vote || (poll.vote.votedFor !== poll.options[pendingVoteIndex])) {
            allVoted = false
            try {
              socket.send(JSON.stringify({
                type: 'vote',
                pollId: poll._id,
                option: poll.options[pendingVoteIndex],
                _id: 'catch'
              }))
            } catch (e) {
              close()
              reject(e)
            }
          }
        }
        if (allVoted) {
          if (closeConnectionTimeout !== null) {
            clearTimeout(closeConnectionTimeout)
            closeConnectionTimeout = null
          } else {
            resolve()
          }
          closeConnectionTimeout = setTimeout(() => {
            close()
          }, Math.ceil(Math.random() * 60000))
        }
      } catch (e) {
        close()
        reject(e)
      }
    }
  })
}

function decideWhatToVote () {
  let bias = args.voteBias
  let sum = bias.reduce((a, b) => a + b)
  let cul = 0
  let culProbs = []
  for (let prob of bias) {
    cul += prob
    culProbs.push(cul / sum)
  }
  let rand = Math.random()
  for (let o = 0; o < bias.length; o ++) {
    if (rand <= culProbs[o]) return o
  }
  return bias.length - 1 // This should never happen, but just in case...
}

function showProgress () {
  readline.clearLine(process.stderr, 0)
  readline.cursorTo(process.stderr, 0, null)
  process.stderr.write(`-> ${activeConnections.toString().padStart(2, ' ')} <- [ ${threadQueues.map(s => s.size.toString().padStart(2, ' ')).join(', ')} ] ...`)
}
let progressInterval = setInterval(showProgress, 100)
showProgress()

Promise.all(threadQueues.map(initThread)).then(waitForConnectionClose).then(() => {
  clearInterval(progressInterval)
  showProgress()
  process.stderr.write('\n')
  process.exit(0)
}, err => {
  clearInterval(progressInterval)
  showProgress()
  process.stderr.write('\n')
  process.stderr.write(err.toString() + '\n')
  process.stderr.write(err.stack + '\n')
  process.exit(1)
})

function waitForConnectionClose () {
  return new Promise((resolve, reject) => {
    let v = setInterval(() => {
      if (activeConnections <= 0) {
        clearInterval(v)
        resolve()
      }
    }, 20)
  })
}
