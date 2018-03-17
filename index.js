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

module.exports = ({mongodb: db}) => {
  let rMain = express.Router()

  require('./lib/dbModel.js')(db).then(({}) => {
    rMain.get('/', function (req, res, next) {
      res.type('html')
      res.send(indexHtml)
    })

    rMain.use('/resources', express.static(path.join(__dirname, 'dist')))
  }, err => {
    rMain.use(function (req, res, next) {
      next(err)
    })
    console.error(err)
  })

  return rMain
}
