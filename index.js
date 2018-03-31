const express = require.main.require('express')
const path = require('path')
const fs = require('fs')
const mongoose = require.main.require('mongoose')

let indexPath = path.join(__dirname, 'dist/index.html')
let indexHtml = fs.readFileSync(indexPath)
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
  let {Manager, Voter, Poll, Vote, GetSecret} = require('./lib/dbModel')(db)

  rMain.get('/', function (req, res, next) {
    res.type('html')
    res.send(indexHtml)
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
      ws.on('message', function (msg) {
        if (closed) return
        if (typeof msg !== 'string') {
          ws.close(1, 'Invalid message, should be UTF-8 string.')
          closed = true
          return
        }
        let obj
        try {
          obj = JSON.parse(msg)
          if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error()
        } catch (e) {
          ws.close(1, 'Invalid JSON.')
          closed = true
          return
        }
        if (!Number.isSafeInteger(obj._id)) obj._id = null
        function reply (ct) {
          // TODO
          setTimeout(() => {
            try {
              ws.send(JSON.stringify(Object.assign(ct, {_id: obj._id})))
            } catch (e) {
              try {
                ws.close(0)
              } catch (e) {}
            }
          }, 500)
        }
        try {
          if (obj.type === 'ping') {
            return reply({})
          } else if (obj.type === 'login') {
            let sSecret = (obj.secret || '').trim()
            if (!sSecret) return reply({error: 'Empty secret'})
            let secret = Buffer.from(sSecret, 'base64')
            if (obj.role === 'voter') {
              Voter.findOne({secret}).then(voter => {
                if (!voter) {
                  reply({error: 'Invalid secret'})
                } else {
                  authType = 'voter'
                  authIdDoc = voter
                  reply({})
                }
              }, err => reply({error: err.message}))
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
              })
            } else {
              throw new Error(`Invalid role ${obj.role}`)
            }
          } else if (obj.type === 'register') {
            GetSecret().then(secret => {
              let m = new Manager({
                secret
              })
              m.save().then(() => {
                authType = 'manager'
                authIdDoc = m
                reply({secret: secret.toString('base64')})
              }, err => {
                reply({error: err.message})
              })
            }, err => {
              reply({error: err.message})
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
            })
          } else if (obj.type === 'pollRemoveVoter') {
            if (authType !== 'manager' || !authIdDoc) {
              return void reply({error: 'Need to be logged in as manager.'})
            }
            Poll.findOne({_id: obj.id}).then(poll => {
              if (!poll) return void reply({error: 'No such poll'})
              if (typeof obj.voter !== 'string') return void reply({error: 'Invalid voter'})
              if (poll.manager.equals(authIdDoc._id)) {
                Poll.update({_id: poll.id}, {$pullAll: {voters: [Buffer.from(obj.voter, 'base64')]}}, {upsert: false, multi: false}).then(() => {
                  Poll.findOne({_id: poll.id}, {voters: true}).then(poll => {
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
          } else {
            throw new Error(`Invalid message type ${obj.type}`)
          }
        } catch (e) {
          reply({error: e.message})
        }
      })
    }
  })

  return rMain
}
