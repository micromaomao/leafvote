const express = require.main.require('express')
const path = require('path')
const fs = require('fs')
const mongoose = require.main.require('mongoose')
const crypto = require('crypto')

let indexPath = path.join(__dirname, 'dist/index.html')
let indexHtml = fs.readFileSync(indexPath)

const procschd = require('procschd')
let procschdServer = null

if (process.env.PROCSCHD_URL) {
  procschd.ProcschdServer.connect(process.env.PROCSCHD_URL, process.env.PROCSCHD_AUTH_TOKEN || "").then(ps => {
    console.log("[Leafvote] Procschd connected successfully.")
    procschdServer = ps
  }, err => {
    console.error("Unable to connect to procschd server: " + err)
  })
} else {
  console.error("Specify env.PROCSCHD_URL and env.PROCSCHD_AUTH_TOKEN to connect to procschd server.")
}

if (process.env.NODE_ENV !== 'production') {
  fs.watch(indexPath, list => {
    fs.readFile(indexPath, { encoding: 'utf8' }, (err, data) => {
      if (err) {
        console.error(err)
        process.exit(1)
      } else {
        indexHtml = data
      }
    })
  })
}

module.exports = ({mongodb: db, addWSHandler}) => {
  let rMain = express.Router()
  let {Manager, Poll, Vote, GetSecret} = require('./lib/dbModel')(db)

  rMain.get('/', function (req, res, next) {
    res.type('html')
    res.send(indexHtml)
  })

  let pdfBlobs = {}

  rMain.get('/getpdf', function (req, res, next) {
    let key = req.query.key
    if (pdfBlobs[key]) {
      res.type('pdf')
      res.send(pdfBlobs[key])
      delete pdfBlobs[key]
    } else {
      res.status(404)
      res.send('Invalid key.')
    }
  })

  rMain.use('/resources', express.static(path.join(__dirname, 'dist')))

  addWSHandler({
    hostname: 'leafvote.mww.moe',
    shouldHandle: function (req) {
      return req.url === '/'
    },
    onConnection: function (ws, req) {
      let closed = false
      let authIdDoc = null
      let authType = null
      let authVoterSecret = null
      let voterPushInterval = null
      let presentationPushInterval = null
      function voterInfoPush () {
        if (closed) {
          if (voterPushInterval !== null) {
            clearInterval(voterPushInterval)
            voterPushInterval = null
          }
          return
        }
        if (authType !== 'voter' || authVoterSecret === null) return
        Poll.aggregate([
          {$match: {voters: authVoterSecret}},
          {$lookup: {
            from: Vote.collection.name,
            let: { pid: '$_id' },
            pipeline: [ {$match: {$expr: {$and: [{$eq: ['$pollId', '$$pid']}, {$eq: ['$doneBy', {$literal: authVoterSecret}]}]}}}, {$project: {_id: false, votedFor: true, valid: true}} ],
            as: 'votes'
          }},
          {$project: {
            _id: true,
            active: true,
            options: true,
            label: true,
            vote: {$arrayElemAt: ['$votes', -1]}
          }},
          {$sort: {
            active: -1,
            label: 1
          }}
        ]).then(polls => {
          if (closed) return
          try {
            ws.send(JSON.stringify({
              _id: null,
              type: 'voterPush',
              polls
            }))
          } catch (e) {
            try {
              ws.close(1013)
              closed = true
            } catch (e) {}
          }
        }, err => {
          // TODO
          console.error(err)
        })
      }
      ws.on('message', function (msg) {
        if (closed) return
        if (typeof msg !== 'string') {
          ws.close(1003, 'Invalid message, should be UTF-8 string.')
          closed = true
          return
        }
        let obj
        try {
          obj = JSON.parse(msg)
          if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error()
        } catch (e) {
          ws.close(1007, 'Invalid JSON.')
          closed = true
          return
        }
        if (!Number.isSafeInteger(obj._id) && typeof obj._id !== 'string') obj._id = null
        function reply (ct) {
          try {
            ws.send(JSON.stringify(Object.assign(ct, {_id: obj._id})))
          } catch (e) {
            try {
              ws.close(1013)
              closed = true
            } catch (e) {}
          }
        }
        try {
          if (obj.type === 'ping') {
            return reply({})
          } else if (obj.type === 'login') {
            let sSecret = (obj.secret || '').trim()
            if (!sSecret) return reply({error: 'Empty secret'})
            let secret = Buffer.from(sSecret, 'base64')
            if (obj.role === 'voter') {
              Poll.findOne({voters: secret}, {_id: true}).then(poll => {
                if (poll) {
                  authType = 'voter'
                  authVoterSecret = secret
                  voterPushInterval = setInterval(voterInfoPush, 1000)
                  reply({})
                  voterInfoPush()
                } else {
                  reply({error: "Double check your secret."})
                }
              }, err => {
                reply({error: err.message})
              })
            } else if (obj.role === 'manager') {
              Manager.findOne({secret}).then(manager => {
                if (!manager) {
                  reply({error: 'Invalid secret'})
                } else {
                  authType = 'manager'
                  authIdDoc = manager
                  Poll.find({manager: manager._id}, {active: true, options: true, label: true}).then(polls => {
                    reply({polls})
                  }, err => {
                    reply({})
                  })
                }
              }, err => {
                reply({error: err.message})
              })
            } else {
              throw new Error(`Invalid role ${obj.role}`)
            }
          } else if (obj.type === 'register') {
            GetSecret().then(secret => {
              let m = new Manager({
                secret
              })
              return m.save().then(() => {
                authType = 'manager'
                authIdDoc = m
                reply({secret: secret.toString('base64')})
              }, err => {
                reply({error: err.message})
              })
            })
          } else if (obj.type === 'listPoll') {
            if (authType !== 'manager' || !authIdDoc) {
              return void reply({error: 'Need to be logged in as manager.'})
            }
            Poll.find({manager: authIdDoc._id}, {active: true, options: true, label: true}).then(polls => {
              reply({polls})
            }, err => {
              reply({error: err.message})
            })
          } else if (obj.type === 'createPoll') {
            if (authType !== 'manager' || !authIdDoc) {
              return void reply({error: 'Need to be logged in as manager.'})
            }
            let p = new Poll({
              manager: authIdDoc._id
            })
            p.save().then(() => {
              reply({pollId: p._id.toString()})
            }, err => {
              reply({error: err.message})
            })
          } else if (obj.type === 'deletePoll') {
            if (authType !== 'manager' || !authIdDoc) {
              return void reply({error: 'Need to be logged in as manager.'})
            }
            Poll.findOne({_id: obj.id}, {manager: true}).then(poll => {
              if (!poll) {
                return void reply({error: 'No such poll'})
              }
              if (poll.manager.equals(authIdDoc._id)) {
                poll.remove().then(() => {
                  reply({})
                }, err => {
                  reply({error: err.message})
                })
              } else {
                reply({error: "You're not the owner of that poll."})
              }
            }, err => { reply({error: err.message}) })
          } else if (obj.type === 'labelPoll') {
            if (authType !== 'manager' || !authIdDoc) {
              return void reply({error: 'Need to be logged in as manager.'})
            }
            let label = obj.label
            if (typeof label !== 'string') {
              return void reply({error: 'Need label prop.'})
            }
            Poll.findOne({_id: obj.id}, {manager: true}).then(poll => {
              if (!poll) {
                return void reply({error: 'No such poll'})
              }
              if (poll.manager.equals(authIdDoc._id)) {
                Poll.update({_id: obj.id}, {$set: {label}}, {multi: false, upsert: false}).then(() => {
                  reply({})
                }, err => {
                  reply({error: err.message})
                })
              } else {
                reply({error: "You're not the owner of that poll."})
              }
            }, err => { reply({error: err.message}) })
          } else if (obj.type === 'getPollVoters') {
            if (authType !== 'manager' || !authIdDoc) {
              return void reply({error: 'Need to be logged in as manager.'})
            }
            Poll.findOne({_id: obj.id}).then(poll => {
              if (!poll) {
                return void reply({error: 'No such poll'})
              }
              if (poll.manager.equals(authIdDoc._id)) {
                reply({voters: poll.voters.map(x => x.toString('base64'))})
              } else {
                reply({error: "You're not the owner of that poll."})
              }
            }, err => { reply({error: err.message}) })
          } else if (obj.type === 'pollAddVoters') {
            if (authType !== 'manager' || !authIdDoc) {
              return void reply({error: 'Need to be logged in as manager.'})
            }
            Poll.findOne({_id: obj.id}).then(poll => {
              if (!poll) {
                return void reply({error: 'No such poll'})
              }
              if (poll.manager.equals(authIdDoc._id)) {
                let n = obj.n
                if (!Number.isSafeInteger(n) || n <= 0) {
                  return void reply({error: 'n must be a positive integer'})
                }
                if (n > 400) {
                  return void reply({error: 'You can only do maximum 400 at a time.'})
                }
                let secrets = []
                function genSecret () {
                  if (secrets.length >= n) {
                    return void done()
                  }
                  GetSecret().then(s => {
                    secrets.push(s)
                    genSecret()
                  }, err => {
                    return void reply({error: err.message})
                  })
                }
                function done () {
                  Poll.update({_id: poll.id}, {$addToSet: {voters: {$each: secrets}}}, {upsert: false, multi: false}).then(() => {
                    Poll.findOne({_id: poll._id}, {voters: true}).then(poll => {
                      if (poll) {
                        return void reply({voters: poll.voters.map(x => x.toString('base64'))})
                      } else {
                        return void reply({})
                      }
                    }, err => {
                      reply({})
                    })
                  }, err => {
                    return void reply({error: err.message})
                  })
                }
                genSecret()
              } else {
                reply({error: "You're not the owner of that poll."})
              }
            }, err => { reply({error: err.message}) })
          } else if (obj.type === 'pollRemoveAllVoters') {
            if (authType !== 'manager' || !authIdDoc) {
              return void reply({error: 'Need to be logged in as manager.'})
            }
            Poll.findOne({_id: obj.id}).then(poll => {
              if (!poll) return void reply({error: 'No such poll'})
              if (poll.manager.equals(authIdDoc._id)) {
                Poll.update({_id: poll.id}, {$set: {voters: []}}, {upsert: false, multi: false}).then(() => {
                  return void reply({})
                }, err => {
                  return void reply({error: err.message})
                })
              } else {
                return void reply({error: "You're not the owner of that poll."})
              }
            }, err => { reply({error: err.message}) })
          } else if (obj.type === 'pollRemoveVoter') {
            if (authType !== 'manager' || !authIdDoc) {
              return void reply({error: 'Need to be logged in as manager.'})
            }
            Poll.findOne({_id: obj.id}).then(poll => {
              if (!poll) return void reply({error: 'No such poll'})
              if (typeof obj.voter !== 'string') return void reply({error: 'Invalid voter'})
              if (poll.manager.equals(authIdDoc._id)) {
                Poll.update({_id: poll._id}, {$pullAll: {voters: [Buffer.from(obj.voter, 'base64')]}}, {upsert: false, multi: false}).then(() => {
                  Poll.findOne({_id: poll._id}, {voters: true}).then(poll => {
                    if (!poll) return void reply({})
                    return void reply({voters: poll.voters.map(x => x.toString('base64'))})
                  }, err => {
                    return void reply({})
                  })
                }, err => {
                  return void reply({error: err.message})
                })
              } else {
                return void reply({error: "You're not the owner of that poll."})
              }
            }, err => {
              return void reply({error: err.message})
            })
          } else if (obj.type === 'pollImportVoters') {
            if (authType !== 'manager' || !authIdDoc) {
              return void reply({error: 'Need to be logged in as manager.'})
            }
            Promise.all([Poll.findOne({_id: obj.from}), Poll.findOne({_id: obj.to})]).then(([from, to]) => {
              if (!from) {
                return void reply({error: 'Source poll not find.'})
              }
              if (!to) {
                return void reply({error: 'Target poll not find.'})
              }
              if (from.manager.equals(authIdDoc._id) && to.manager.equals(authIdDoc._id)) {
                Poll.update({_id: to._id}, {$addToSet: {voters: {$each: from.voters}}}, {upsert: false, multi: false}).then(() => {
                  Poll.findOne({_id: to._id}, {voters: true}).then(to => {
                    if (!to) return void reply({})
                    return void reply({targetPollVoters: to.voters.map(x => x.toString('base64'))})
                  }, err => {
                    return void reply({})
                  })
                })
              } else {
                return void reply({error: 'Premission denied.'})
              }
            }, err => {
              return void reply({error: err.message})
            })
          } else if (obj.type === 'pollSetOptions') {
            if (authType !== 'manager' || !authIdDoc) {
              return void reply({error: 'Need to be logged in as manager.'})
            }
            let options = obj.options
            if (!Array.isArray(options) || !options.every(x => typeof x === 'string')) return void reply({error: 'options must be an array of strings.'})
            Poll.findOne({_id: obj.id}).then(poll => {
              if (!poll) return void reply({error: 'No such poll'})
              if (poll.manager.equals(authIdDoc._id)) {
                Poll.update({_id: poll._id}, {$set: {options}}, {upsert: false, multi: false}).then(() => {
                  return void reply({})
                }, err => {
                  return void reply({error: err.message})
                })
              } else {
                return void reply({error: "You're not the owner of that poll."})
              }
            }, err => {
              return void reply({error: err.message})
            })
          } else if (obj.type === 'pollSetActive') {
            if (authType !== 'manager' || !authIdDoc) {
              return void reply({error: 'Need to be logged in as manager.'})
            }
            Poll.findOne({_id: obj.id}).then(poll => {
              if (!poll) return void reply({error: 'No such poll'})
              if (poll.manager.equals(authIdDoc._id)) {
                Poll.update({_id: poll._id}, {$set: {active: !!obj.active}}, {upsert: false, multi: false}).then(() => {
                  return void reply({})
                }, err => {
                  return void reply({error: err.message})
                })
              } else {
                return void reply({error: "You're not the owner of that poll."})
              }
            }, err => {
              return void reply({error: err.message})
            })
          } else if (obj.type === 'vote') {
            if (authType !== 'voter' || !authVoterSecret) {
              return void reply({error: 'Need to be logged in as voter.'})
            }
            if (typeof obj.option !== 'string') return void reply({error: 'Need "option" to be a string.'})
            Poll.findOne({_id: obj.pollId, voters: authVoterSecret, active: true}).then(poll => {
              if (!poll) return void reply({error: "Either no such poll, or you don't have the permission to vote."})
              Vote.update({pollId: poll._id, doneBy: authVoterSecret}, {$set: {votedFor: obj.option}, $setOnInsert: {valid: true}}, {multi: false, upsert: true}).then(() => {
                return void reply({})
              }, err => {
                return void reply({error: err.message})
              })
            }, err => {
              return void reply({error: err.message})
            })
          } else if (obj.type === 'poll-subscribe') {
            if (authType !== 'manager' || !authIdDoc) {
              return void reply({error: 'Need to be logged in as manager.'})
            }
            Poll.findOne({_id: obj.id}).then(poll => {
              if (poll.manager.equals(authIdDoc._id)) {
                if (presentationPushInterval !== null) {
                  clearInterval(presentationPushInterval)
                  presentationPushInterval = null
                }
                presentationPushInterval = setInterval(function () {
                  if (closed) {
                    if (presentationPushInterval !== null) {
                      clearInterval(presentationPushInterval)
                      presentationPushInterval = null
                    }
                    return
                  }
                  if (authType !== 'manager' || authIdDoc === null) return
                  function send (obj) {
                    if (closed) return
                    try {
                      ws.send(JSON.stringify(Object.assign(obj, {
                        _id: null,
                        type: 'presentationPush'
                      })))
                    } catch (e) {
                      try {
                        ws.close(1013)
                        closed = true
                      } catch (e) {}
                    }
                  }
                  Poll.findOne({_id: poll._id}, {active: true, options: true, label: true}).then(poll => {
                    if (!poll) return void send({error: 'Poll no longer existed.'})
                    Vote.aggregate([
                      {$match: {
                        pollId: poll._id,
                        valid: true
                      }},
                      {$group: {
                        _id: '$votedFor',
                        count: {$sum: 1}
                      }},
                      {$sort: {
                        _id: 1
                      }}
                    ]).then(results => {
                      /* function rand () {
                        return Math.ceil(Math.sqrt(Math.random() * 10000))
                      }
                      return void send({
                        meta: poll,
                        results: [{candidate:"Blablablabla", count:30}, {candidate:"Cand A", count:0}, {candidate:"Cand Bbbb", count:0}, {candidate:"Cand C", count:20}]
                      }) */
                      send({
                        meta: poll,
                        results: results.map(x => ({candidate: x._id, count: x.count}))
                      })
                    })
                  }, err => {
                    send({error: err.message})
                  })
                }, 500)
                return void reply({})
              } else {
                return void reply({error: 'Permission denied.'})
              }
            }, err => {
              return void reply({error: err.message})
            })
          } else if (obj.type === 'poll-unsubscribe') {
            if (presentationPushInterval !== null) {
              clearInterval(presentationPushInterval)
              presentationPushInterval = null
            }
            return void reply({})
          } else if (obj.type === "printTickets") {
            let voters = obj.voters
            if (!Array.isArray(voters)) {
              return void reply({
                error: "Invalid type for .voters"
              })
            }
            if (!procschdServer) {
              return void reply({
                error: "Service not available."
              })
            }
            procschdServer.runTask({
              imageId: "ghcr.io/micromaomao/leafvote-tex-image",
              stdin: voters.join("\n"),
              fetchArtifacts: ["/tmp/in.pdf"]
            }).then(taskId => procschdServer.taskInfo(taskId, true))
              .then(taskInfo => {
                if (taskInfo.error) {
                  if (taskInfo.error.indexOf('exited') >= 0) {
                    console.error('procschd container error: ' + taskInfo.error + '\n    stdout = ' + taskInfo.stdout + '\n    stderr = ' + taskInfo.stderr)
                  }
                  return void reply({error: taskInfo.error})
                }
                procschdServer.downloadArtifact(taskInfo.id, "/tmp/in.pdf").then(ss => {
                  let chunks = []
                  let replied = false
                  ss.on('data', buf => {
                    if (replied) return
                    chunks.push(buf)
                  })
                  ss.on('end', () => {
                    if (replied) return
                    replied = true
                    let pdfBlob = Buffer.concat(chunks)
                    crypto.randomBytes(16, (err, buf) => {
                      if (err) {
                        return void reply({error: err.toString()})
                      }
                      let key = buf.toString('hex')
                      pdfBlobs[key] = pdfBlob
                      reply({error: null, url: '/getpdf?key=' + encodeURIComponent(key)})
                    })
                  })
                  ss.on('error', err => {
                    if (replied) return
                    replied = true
                    reply({error: err.toString()})
                  })
                }, err => {
                  reply({
                    error: err.toString()
                  })
                })
              }, err => {
                reply({
                  error: err.toString()
                })
              })
          } else {
            throw new Error(`Invalid message type ${obj.type}`)
          }
        } catch (e) {
          reply({error: e.message})
        }
      })
      ws.on('close', () => {
        closed = true
        if (voterPushInterval !== null) {
          clearInterval(voterPushInterval)
          voterPushInterval = null
        }
        if (presentationPushInterval !== null) {
          clearInterval(presentationPushInterval)
          presentationPushInterval = null
        }
      })
    }
  })

  return rMain
}
