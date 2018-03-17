const mongoose = require.main.require('mongoose')
const crypto = require('crypto')

module.exports = db => {

  function GetSecret () {
    return new Promise((resolve, reject) => {
      crypto.randomBytes(9, function (err, buf) {
        if (err) {
          return void reject(err)
        }
        resolve(buf)
      })
    })
  }

  let managerSchema = new mongoose.Schema({
    secret: {type: 'Buffer', index: true, required: true}
  })
  let pollSchema = new mongoose.Schema({
    manager: {type: 'ObjectId', index: true, required: true},
    active: {type: 'Boolean', default: false},
    options: {type: 'Array', default: []}, // list of `votedFor` possibilities
    label: {type: 'String', default: ''},
    voters: {type: ['Buffer'], default: [], index: true} // list of secrets
  })
  let voteSchema = new mongoose.Schema({
    doneBy: {type: 'Buffer', required: true}, // the secret
    pollId: {type: 'ObjectId', required: true},
    votedFor: {type: 'String', required: true},
    valid: {type: 'Boolean', default: true} // for avoiding race-condition and locking somebody from voting.
  })
  voteSchema.index({pollId: 1, doneBy: 1})
  voteSchema.index({pollId: 1, votedFor: 1})

  function registerDBModel (name, schema) {
    let model
    try {
      model = db.model(name, schema)
    } catch (e) {
      model = db.model(name)
    }
    if (!model) throw new Error(`model of ${name} undefined.`)
    model.on('index', err => {
      if (err) {
        console.error(`Error building index for ${name}: `)
        console.error(err)
      } else {
        console.log(`Building index for ${name}.`)
      }
    })
    return model
  }

  let Manager = registerDBModel('manager', managerSchema)
  let Poll = registerDBModel('poll', pollSchema)
  let Vote = registerDBModel('vote', voteSchema)

  return {Manager, Poll, Vote, GetSecret}
}
