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
          }, 1000)
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
                  Poll.find({manager: manager._id}).then(polls => {
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
            Poll.find({manager: authIdDoc._id}).then(polls => {
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
            })
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
