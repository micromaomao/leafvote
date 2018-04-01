'use strict'

require('babel-polyfill')
require('fetch-polyfill')

const React = require('react')
const ReactDOM = require('react-dom')

// Polyfill
window.requestIdleCallback = window.requestIdleCallback || (func => setTimeout(func, 1000))
window.cancelIdleCallback = window.cancelIdleCallback || (id => clearTimeout(id))

require('style-loader!./layout.sass')

class AppMain extends React.Component {
  constructor (props) {
    super(props)
    this.state = {
      error: null,
      errorInfo: null
    }
    this.handleWindowResize = this.handleWindowResize.bind(this)
    this.handleReload = this.handleReload.bind(this)
    this.animationFrame = null
  }

  componentDidMount () {
    window.addEventListener('resize', this.handleWindowResize)
  }
  handleWindowResize (evt) {
    if (this.animationFrame === null) {
      this.animationFrame = requestAnimationFrame(() => {
        this.animationFrame = null
        if (this.app === null) return
        this.app.forceUpdate()
      })
    }
  }
  componentWillUnmount () {
    window.removeEventListener('resize', this.handleWindowResize)
  }

  render () {
    if (this.state.error) {
      return (
        <div className='schsrch-main-crash'>
          <h1>:(</h1>
          <h2>Something went terribly wrong&hellip;</h2>
          <p>LeafVote has run into an error and must be reloaded before it can work again.</p>
          <div className='reload-btn-contain'>
            <a className='reload-btn' onClick={this.handleReload}>Reload</a>
          </div>
          <p>Sorry for this&hellip;</p>
          <pre>{this.state.error.message + '\n' + this.state.error.stack}</pre>
          <pre>{this.state.errorInfo.componentStack.toString()}</pre>
        </div>
      )
    }
    return <LeafVote ref={f => this.app = f} />
  }

  componentDidCatch (error, info) {
    this.setState({error, errorInfo: info})
    console.error(error)
    console.error(info)
  }

  handleReload (evt) {
    window.location.reload(false)
  }
}

class LeafVote extends React.Component {
  constructor (props) {
    super(props)
    this.state = {
      socket: null,
      socketState: 'disconnected',
      latency: null,
      login: null,
      loginning: null,
      polls: null,
      pollsError: null,
      selectingVoterImport: null,
      pendingVote: {},
      votingErrors: {}
    }
    this.messageCallbacks = []
    this.messageId = 0
    this.latencySetTimeout = null
    this.flushVotesTimeout = null
    this.testLatency = this.testLatency.bind(this)
    this.handleLogin = this.handleLogin.bind(this)
    this.handleCreateManager = this.handleCreateManager.bind(this)
    this.handleLogout = this.handleLogout.bind(this)
    this.handlePollCreate = this.handlePollCreate.bind(this)
    this.reloadPolls = this.reloadPolls.bind(this)
  }

  initSocket () {
    if (this.state.socket) {
      if (this.state.socket.readyState === WebSocket.OPEN) return
    }
    for (let msgCb of this.messageCallbacks) {
      try {
        msgCb(new Error('disconnected'), null)
      } catch (e) {}
    }
    this.messageCallbacks = []
    try {
      let socket = new WebSocket('wss://leafvote.mww.moe')
      this.setState({socket})
      socket.addEventListener('open', evt => {
        this.setState({socketState: 'ready', socketError: null})
        if (this.latencySetTimeout !== null) clearTimeout(this.latencySetTimeout)
        this.testLatency()
        if (this.state.login && this.state.login.secret) {
          this.sendMessage({type: 'login', secret: this.state.login.secret, role: this.state.login.type}).then(res => {
            if (res.error) {
              this.handleLogout()
            }
          }, err => {
            this.handleLogout()
          })
        }
      })
      let errored = false
      socket.addEventListener('error', evt => {
        let socketError = evt.error
        if (!socketError) socketError = new Error('Network error')
        this.setState({socketState: 'disconnected', socketError, socket: null})
        try {
          socket.close(0, 'error occured.')
        } catch (e) {}
        setTimeout(() => {
          this.initSocket()
        }, 100)
        errored = true
      })
      socket.addEventListener('close', evt => {
        if (errored) return
        this.setState({socketState: 'disconnected'})
        this.initSocket()
      })
      socket.addEventListener('message', evt => {
        let {messageCallbacks} = this
        let msg = evt.data
        if (typeof msg !== 'string') {
          return
        }
        try {
          msg = JSON.parse(msg)
        } catch (e) {
          socket.close(1, 'invalid message.')
          this.initSocket()
          return
        }
        if (msg._id === null) {
          if (msg.type === 'voterPush') {
            let pollsData = msg.polls
            if (this.state.login && this.state.login.type === 'voter') {
              this.setState({
                polls: pollsData
              })
              this.flushVotes()
            }
          }
          return
        }
        if (!Number.isSafeInteger(msg._id)) return
        if (!messageCallbacks[msg._id]) return
        messageCallbacks[msg._id](null, msg)
        delete messageCallbacks[msg._id]
      })
    } catch (e) {
      this.setState({socketState: 'disconnected', socketError: e, socket: null})
      setTimeout(() => this.initSocket(), 1000)
    }
  }

  testLatency () {
    if (this.latencySetTimeout !== null) clearTimeout(this.latencySetTimeout)
    this.latencySetTimeout = null
    let time = Date.now()
    this.sendMessage({type: 'ping'}).then(() => {
      let nTime = Date.now()
      let latency = (nTime - time) / 2
      this.setState({latency: `${latency}ms`})
      this.latencySetTimeout = setTimeout(this.testLatency, 10000)
    }, err => {
      this.setState({latency: null})
    })
  }

  sendMessage (msg, callback) {
    return new Promise((resolve, reject) => {
      if (!this.state.socket) {
        reject(new Error('Offline.'))
      }
      let id = this.messageId++
      this.messageCallbacks[id] = (err, reply) => {
        if (err) {
          return void reject(err)
        }
        resolve(reply)
      }
      let socket = this.state.socket
      socket.send(JSON.stringify(Object.assign({}, msg, {
        _id: id
      })))
    })
  }

  componentDidMount () {
    this.initSocket()
  }
  componentDidUpdate (prevProps, prevState) {
    if (this.state.loginning) {
      if (prevState.loginning && this.state.loginning.section && this.state.loginning.section !== prevState.loginning.section && this.secretInput) {
        this.secretInput.focus()
      } else if (!prevState.loginning && this.state.loginning.section && this.secretInput) {
        this.secretInput.focus()
      }
    }
  }

  render () {
    return (
      <div className='leafvote'>
        <div className='topbar'>
          <div className='logo'>
            <b>Leaf</b>Vote
          </div>
          <div className='dash'>&mdash;</div>
          {this.getConnectionStatusUI()}
          {this.getLoggedInAs()}
          {this.state.login ? <div className='logout' onClick={this.handleLogout}>Log out</div> : null}
        </div>
        {this.state.login === null ? (
          <div className='view login'>
            <h1>Who are you?</h1>
            {(() => {
              // voter section
              let selectedThis = this.state.loginning && this.state.loginning.section === 'voter'
              if (!selectedThis) {
                return <div className='section unselected voter' onClick={evt => this.setState({loginning: {section: 'voter'}})}>Voter</div>
              } else {
                return <div className='section selected voter'>
                  Voter
                  <div>
                    You should have received a voting ticket with a QR code on it. Scan the code to login. If you are unable to scan, enter the secret shown
                    on the paper below:<br />
                    {this.getSecretInput()}
                    {this.getLoginError()}
                  </div>
                </div>
              }
            })()}
            {(() => {
              // manager section
              let selectedThis = this.state.loginning && this.state.loginning.section === 'manager'
              if (!selectedThis) {
                return <div className='section unselected manager' onClick={evt => this.setState({loginning: {section: 'manager'}})}>Manager</div>
              } else {
                return <div className='section selected manager'>
                  Manager
                  <div>
                    Enter your access token:<br />
                    {!this.state.loginning.managerCreationLoading ? this.getSecretInput() : null}
                    {!this.state.loginning.managerCreationLoading ? this.getLoginError() : null}
                    {!this.state.loginning.managerCreationLoading ? (
                      !this.state.loginning.managerCreationDone ? (
                        <div>
                          You may also <a className='createbtn' onClick={this.handleCreateManager}>register one</a>. Do
                          not register if you are trying to vote.
                        </div>
                      ) : (
                        <div>
                          The string above is your secret (access token). Keep a note of it, ensure that you never lose nor disclose it, and tap "enter".
                        </div>
                      )
                    ) : (
                      <div className='loading'>Registering new token&hellip;</div>
                    )}
                    {this.state.loginning.managerCreationError ? <div className='error'>{this.state.loginning.managerCreationError.message}</div> : null}
                  </div>
                </div>
              }
            })()}
          </div>
        ) : null}
        {this.state.login && this.state.login.type === 'manager' ? (
          <div className='view manager'>
            {this.state.pollCreation && this.state.pollCreation.loading ? (
              <div className='createpoll'>Creating</div>) : (
                this.state.selectingVoterImport ? null : (<div className='createpoll' onClick={this.handlePollCreate}>Create New Poll</div>)
              )}
            {this.state.pollCreation && this.state.pollCreation.error ? (
              <div className='pollCreationError'>{this.state.pollCreation.error.message}</div>
            ) : null}

            {this.state.polls !== null && this.state.polls.length === 0 ? (
              <div className='empty'>No polls created.</div>
            ) : (
              this.state.pollsError ? <div className='pollsListError'>{this.state.pollsError.message}</div> : (
                this.state.polls === null ?  <div className='loading'>Loading your polls&hellip;</div> : null
              )
            )}
            {this.state.pollActionError ? <div className='pollsListError'>{this.state.pollActionError.message}</div> : null}
            {this.state.polls !== null && this.state.selectingVoterImport !== null ? (
              <div className='selectingvoterimportprompt'>
                Select the poll from which to import voter&hellip;<br />
                <div className='cancel' onClick={evt => this.handleSelectImportingCancel()}>
                  Cancel
                </div>
              </div>
            ) : null}
            {this.state.polls !== null ? this.state.polls.map(poll => {
              return (
                <div className='poll' key={poll._id} onClick={this.state.selectingVoterImport ? (evt => this.handleSelectImportingFrom(poll)) : null}>
                  <div className='top'>
                    <div className='labelcontain'>
                      {this.state.selectingVoterImport ? (
                        <div>{poll.label || '(no label)'}</div>
                      ) : (
                        <input type='text' value={poll.label} placeholder='(no label)' onChange={evt => this.handleLabelPoll(poll, evt.target.value)} />
                      )}
                    </div>
                    {!this.state.selectingVoterImport ? (
                      <div className='delete' onClick={evt => this.handleDeletePoll(poll)}>
                        Delete
                      </div>
                    ) : null}
                  </div>
                  {this.state.selectingVoterImport ? (
                    poll._id === this.state.selectingVoterImport.to._id ? (
                      <div className='selectingtothis'>
                        Voters will be imported into this poll.
                      </div>
                    ) : (
                      poll._id === this.state.selectingVoterImport.selection ? (
                        <div className='bottom'>
                          <div className='btn' onClick={evt => this.handleDoImport(poll)}>
                            Import from this poll
                          </div>
                        </div>
                      ) : null
                    )
                  ) : (
                    !poll.voters && !poll.editingOptions ? (
                      <div className='bottom'>
                        <div className='btn' onClick={evt => this.handleLoadVoters(poll)}>
                          Manage voters
                        </div>
                        <div className='btn' onClick={evt => this.handleManageOptions(poll)}>
                          Manage options (candidates)
                        </div>
                        {!poll.active ? (
                          <div className='btn' onClick={evt => this.handleSetActive(poll, true)}>
                            Open opll
                          </div>
                        ) : (
                          <div className='btn' onClick={evt => this.handleSetActive(poll, false)}>
                            Close poll
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className='bottom'>
                        {poll.voters && !poll.voters.opDoing ? [
                          <div key={-1} className='btn' onClick={evt => this.handlePollCloseEditing(poll)}>Close</div>,
                          <input key={0} className='opNumber' type='number' min={1} value={poll.voters.opNumber} onChange={evt => this.handleVoterOpNumberChange(poll, evt.target.value)} />,
                          <div key={1} className='btn' onClick={evt => this.handleAddVoters(poll)}>Add</div>,
                          <div key={2} className='btn' onClick={evt => this.handleImportVoter(poll)}>Import from poll</div>,
                          <div key={3} className='btn' onClick={evt => this.handleRemoveAllVoters(poll)}>Remove all</div>,
                          <input key={4} className='filter' type='text' placeholder='(filter)' value={poll.voters.filter || ''} onChange={evt => this.handleVoterFilterChange(poll, evt.target.value)} />
                        ] : null}
                        {poll.voters && poll.voters.opDoing ? <div className='opDoing'>Processing&hellip;</div> : null}
                        {poll.voters && poll.voters.opError ? <div className='error'>{poll.voters.opError.message}</div> : null}
                        {poll.editingOptions && !poll.optionsDoing ? [
                          <div key={0} className='btn' onClick={evt => this.handleCancelOptionsEditor(poll)}>
                            Cancel
                          </div>,
                          <div key={1} className='btn' onClick={evt => this.handleSaveOptions(poll)}>
                            Save
                          </div>
                        ] : null}
                        {poll.editingOptions && poll.optionsDoing ? (
                          <div className='opDoing'>
                            Saving&hellip;
                          </div>
                        ) : null}
                        {poll.editingOptions && poll.optionsSetError ? (
                          <div className='error'>{poll.optionsSetError.message}</div>
                        ) : null}
                      </div>
                    )
                  )}
                  {(() => {
                    if (!poll.voters) return null
                    if (this.state.selectingVoterImport) return null
                    if (poll.voters.loading) return <div className='voters loading'>Loading</div>
                    if (poll.voters.error) return <div className='voters error'>{poll.voters.error.message}</div>
                    if (!poll.voters.voters || poll.voters.voters.length === 0) return <div className='voters empty'>No voters added.</div>
                    return (
                      <div className={'voters list' + (poll.voters.opDoing ? ' doing' : '')}>
                        {poll.voters.voters.filter(x => x.indexOf(poll.voters.filter || '') >= 0).map(secret => {
                          return (
                            <div className='voter' key={secret}>
                              <div className='secret'>{secret}</div>
                              <div className='btns'>
                                <div className='btn' onClick={evt => this.handleRemoveOneVoter(poll, secret)}>Delete</div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                  {poll.editingOptions ? (
                    <div className='optionseditor'>
                      <textarea value={poll.optionsEditorValue} onChange={evt => this.handleOptionsEditorInput(poll, evt.target.value)} disabled={poll.optionsDoing} />
                    </div>
                  ) : null}
                </div>
              )
            }) : null}
          </div>
        ) : null}
        {this.state.login && this.state.login.type === 'voter' ? (
          <div className='view voter'>
            {!this.state.polls ? (
              <div className='loading'>
                Loading polls&hellip;
              </div>
            ) : null}
            {Array.isArray(this.state.polls) ? this.state.polls.map(poll => {
              let pending = this.state.pendingVote[poll._id] || null
              let vote = pending ? pending : (poll.vote ? poll.vote.votedFor : null)
              let voteReachedServer = poll.vote && (poll.vote.votedFor === pending || pending === null)
              let votingError = this.state.votingErrors[poll._id]
              return (
                <div className={'poll' + (!poll.active ? ' inactive' : '')} key={poll._id}>
                  {votingError ? (
                    <div className='error'>Error: {votingError.message} - your vote is <b>not</b> counted yet. Check your network or contact staff.</div>
                  ) : null}
                  <div className='label'>{poll.label}</div>
                  <div className='status'>
                    {poll.active ? (
                      !vote ? 'Please cast your vote:' : (
                        voteReachedServer ? 'Your vote is recorded. Thank you.' : 'Casting your vote\u2026'
                      )
                    ) : 'Poll not open.'}
                  </div>
                  {poll.options.map(cand => (
                    <div
                      key={cand}
                      className={'option' + (vote === cand ? ' votedthis' : '') + (vote === cand && !voteReachedServer ? ' pending' : '') + (vote && vote !== cand ? ' notthis' : '')}
                      onClick={poll.active && vote !== cand ? (evt => this.handleVote(poll, cand)) : null} >
                      {cand}
                    </div>
                  ))}
                </div>
              )
            }) : null}
          </div>
        ) : null}
      </div>
    )
  }

  getSecretInput () {
    if (!this.state.loginning) return null
    if (this.state.loginning.loading) return <div className='loading'>Logging in&hellip;</div>
    return (
      <div className='inputcontain'>
        <input type='text' value={this.state.loginning.secretInput || ''} placeholder='Your secret' onChange={evt => this.setState({
          loginning: Object.assign({}, this.state.loginning, {secretInput: evt.target.value})
        })} ref={f => this.secretInput = f}/>
        <div className='enter' onClick={this.handleLogin}>enter</div>
      </div>
    )
  }

  handleLogin (evt) {
    let loginning = Object.assign({}, this.state.loginning, {loading: true, error: null, managerCreationError: null})
    this.setState({
      loginning
    })
    this.sendMessage({type: 'login', secret: loginning.secretInput, role: loginning.section}).then(res => {
      if (res.error) {
        if (this.state.loginning !== loginning) return
        this.setState({loginning: Object.assign({}, loginning, {error: new Error(res.error), loading: false})})
      } else {
        this.setState({login: {type: loginning.section, secret: loginning.secretInput}, loginning: null, polls: res.polls || null})
        if (!res.polls && loginning.section === 'manager') {
          this.reloadPolls()
        }
      }
    }, err => {
      if (this.state.loginning !== loginning) return
      this.setState({loginning: Object.assign({}, loginning, {error: err, loading: false})})
    })
  }

  getLoginError () {
    let loginning = this.state.loginning
    if (!loginning) return null
    if (!loginning.error) return null
    return <div className='error'>{loginning.error.message}</div>
  }

  getConnectionStatusUI () {
    if (this.state.socketState === 'disconnected' && this.state.socketError) {
      return <div className='connection error'>Unable to connect: {this.state.socketError.message}. Retrying</div>
    }
    if (this.state.socketState === 'disconnected' && !this.state.socketError) {
      return <div className='connection disconnected'>Connecting</div>
    }
    if (this.state.socketState === 'ready') {
      return <div className='connection ready'>{this.state.latency || '✓'}</div>
    }
    return <div className='connection'>{this.state.socketState}</div>
  }

  getLoggedInAs () {
    if (this.state.login === null) {
      return null
    }
    if (this.state.login.type === 'voter') {
      return <div className='id voter'>Logged in as voter</div>
    }
    if (this.state.login.type === 'manager') {
      return <div className='id voter'>Logged in as manager</div>
    }
  }

  handleCreateManager () {
    let loginning = Object.assign({}, this.state.loginning, {
      managerCreationLoading: true,
      managerCreationError: null,
      error: null // error from login
    })
    this.setState({loginning})
    this.sendMessage({type: 'register'}).then(res => {
      if (res.error) {
        if (this.state.loginning !== loginning) return
        this.setState({loginning: Object.assign({}, loginning, {managerCreationError: new Error(res.error), managerCreationLoading: false})})
      } else {
        this.setState({loginning: Object.assign({}, loginning, {managerCreationLoading: false, secretInput: res.secret, managerCreationDone: true})})
      }
    }, err => {
      if (this.state.loginning !== loginning) return
      this.setState({loginning: Object.assign({}, loginning, {managerCreationError: err, managerCreationLoading: false})})
    })
  }

  handleLogout (evt) {
    this.setState({
      login: null,
      loginning: null
    })
  }

  handlePollCreate () {
    if (!this.state.login) return
    this.setState({pollCreation: {loading: true, error: null}})
    this.sendMessage({type: 'createPoll'}).then(res => {
      if (res.error) {
        return void this.setState({pollCreation: {loading: false, error: new Error(res.error)}, pollActionError: null})
      }
      this.setState({pollCreation: null, pollActionError: null})
      this.reloadPolls()
    }, err => {
      this.setState({pollCreation: {loading: false, error: err}, pollActionError: null})
    })
  }

  reloadPolls () {
    if (!this.state.login) return
    this.setState({polls: null, pollsError: null, selectingVoterImport: null})
    this.sendMessage({type: 'listPoll'}).then(res => {
      if (res.error) {
        return void this.setState({pollsError: new Error(res.error)})
      }
      this.setState({polls: res.polls, pollsError: null})
    }, err => {
      this.setState({pollsError: err})
    })
  }

  sendPollActionMessage (msg) {
    this.sendMessage(msg).then(res => {
      if (res.error) {
        this.reloadPolls()
        this.setState({pollActionError: new Error(res.error)})
        return
      }
      this.setState({pollActionError: null})
    }, err => {
      this.reloadPolls()
      this.setState({pollActionError: err})
      return
    })
  }

  handleDeletePoll (poll) {
    this.setState({polls: this.state.polls.filter(x => x !== poll)})
    this.sendPollActionMessage({type: 'deletePoll', id: poll._id})
  }

  handleLabelPoll (poll, label) {
    poll.label = label
    this.forceUpdate()
    this.sendPollActionMessage({type: 'labelPoll', id: poll._id, label})
  }

  handleLoadVoters (poll) {
    poll.voters = {
      loading: true,
      error: false,
      opNumber: 10
    }
    this.forceUpdate()
    let thisVoters = poll.voters
    this.sendMessage({type: 'getPollVoters', id: poll._id}).then(res => {
      if (poll.voters !== thisVoters) return
      if (res.error) {
        Object.assign(poll.voters, {
          loading: false,
          error: new Error(res.error)
        })
        this.forceUpdate()
        return
      }
      Object.assign(poll.voters, {
        loading: false,
        voters: res.voters
      })
      this.forceUpdate()
    }, err => {
      if (poll.voters !== thisVoters) return
      Object.assign(poll.voters, {
        loading: false,
        error: err
      })
      this.forceUpdate()
    })
  }

  handlePollCloseEditing (poll) {
    poll.voters = poll.editingOptions = null
    this.forceUpdate()
  }

  handleVoterOpNumberChange (poll, val) {
    if (!poll.voters) return
    poll.voters.opNumber = val
    this.forceUpdate()
  }

  handleAddVoters (poll) {
    if (!poll.voters || poll.voters.opDoing) return
    let n = poll.voters.opNumber
    n = parseInt(n)
    if (!Number.isSafeInteger(n) || n <= 0) {
      poll.voters.opError = new Error('Number must be a positive integer.')
      poll.voters.opDoing = false
      this.forceUpdate()
      return
    }
    poll.voters.opError = null
    poll.voters.opDoing = true
    this.forceUpdate()
    let thisVoters = poll.voters
    this.sendMessage({type: 'pollAddVoters', id: poll._id, n}).then(res => {
      if (poll.voters !== thisVoters) return
      poll.voters.opDoing = false
      if (res.error) {
        poll.voters.opError = new Error(res.error)
      } else {
        poll.voters.voters = res.voters
      }
      this.forceUpdate()
    }, err => {
      if (poll.voters !== thisVoters) return
      poll.voters.opDoing = false
      poll.voters.opError = err
      this.forceUpdate()
    })
  }

  handleRemoveAllVoters (poll) {
    if (!poll.voters || poll.voters.opDoing) return
    poll.voters.opDoing = true
    poll.voters.opError = null
    this.forceUpdate()
    let thisVoters = poll.voters
    this.sendMessage({type: 'pollRemoveAllVoters', id: poll._id}).then(res => {
      if (poll.voters !== thisVoters) return
      poll.voters.opDoing = false
      if (res.error) {
        poll.voters.opError = new Error(res.error)
      } else {
        poll.voters.voters = []
      }
      this.forceUpdate()
    }, err => {
      if (poll.voters !== thisVoters) return
      poll.voters.opDoing = false
      poll.voters.opError = err
      this.forceUpdate()
    })
  }

  handleRemoveOneVoter (poll, voter) {
    if (!poll.voters || poll.voters.opDoing) return
    poll.voters.opDoing = true
    poll.voters.opError = null
    this.forceUpdate()
    let thisVoters = poll.voters
    this.sendMessage({type: 'pollRemoveVoter', id: poll._id, voter: voter}).then(res => {
      if (poll.voters !== thisVoters) return
      poll.voters.opDoing = false
      if (res.error) {
        poll.voters.opError = new Error(res.error)
      } else {
        poll.voters.voters = res.voters
      }
      this.forceUpdate()
    }, err => {
      if (poll.voters !== thisVoters) return
      poll.voters.opDoing = false
      poll.voters.opError = err
      this.forceUpdate()
    })
  }

  handleImportVoter (poll) {
    if (!poll.voters || poll.voters.opDoing) return
    this.setState({selectingVoterImport: {
      to: poll
    }})
  }

  handleSelectImportingFrom (poll) {
    if (!this.state.selectingVoterImport) return
    this.state.selectingVoterImport.selection = poll._id
    this.forceUpdate()
  }

  handleSelectImportingCancel () {
    this.setState({
      selectingVoterImport: null
    })
  }

  handleDoImport (sourcePoll) {
    let targetPoll = this.state.selectingVoterImport.to
    this.setState({
      selectingVoterImport: null
    })
    if (sourcePoll._id === targetPoll._id) return
    targetPoll.voters.opDoing = true
    targetPoll.voters.opError = null
    this.forceUpdate()
    let thisVoters = targetPoll.voters
    this.sendMessage({type: 'pollImportVoters', from: sourcePoll._id, to: targetPoll._id}).then(res => {
      if (targetPoll.voters !== thisVoters) return
      thisVoters.opDoing = false
      if (res.error) {
        thisVoters.opError = new Error(res.error)
      } else {
        thisVoters.voters = res.targetPollVoters
      }
      this.forceUpdate()
    }, err => {
      if (targetPoll.voters !== thisVoters) return
      thisVoters.opDoing = false
      thisVoters.opError = err
      this.forceUpdate()
    })
  }

  handleVoterFilterChange (poll, filter) {
    if (!poll.voters) return
    poll.voters.filter = filter
    this.forceUpdate()
  }

  handleManageOptions (poll) {
    poll.editingOptions = true
    poll.optionsEditorValue = poll.options.join('\n')
    this.forceUpdate()
  }

  handleCancelOptionsEditor (poll) {
    poll.editingOptions = false
    poll.optionsEditorValue = null
    poll.optionsSetError = null
    this.forceUpdate()
  }

  handleOptionsEditorInput (poll, value) {
    poll.optionsEditorValue = value
    this.forceUpdate()
  }

  handleSaveOptions (poll) {
    if (poll.optionsEditorValue === null && !poll.editingOptions) return
    poll.optionsDoing = true
    let options = poll.optionsEditorValue.split('\n').filter(x => x.trim() !== '')
    this.forceUpdate()
    this.sendMessage({type: 'pollSetOptions', id: poll._id, options}).then(res => {
      poll.optionsDoing = false
      if (res.error) {
        poll.optionsSetError = new Error(res.error)
      } else {
        poll.optionsSetError = null
        poll.optionsEditorValue = null
        poll.editingOptions = false
        poll.options = options
      }
      this.forceUpdate()
    }, err => {
      poll.optionsDoing = false
      poll.optionsSetError = err
      this.forceUpdate()
    })
  }

  handleSetActive (poll, active) {
    let oldState = poll.active
    if (oldState === active) return
    poll.active = active
    this.setState({pollsError: null})
    this.sendMessage({type: 'pollSetActive', id: poll._id, active}).then(res => {
      if (res.error) {
        this.reloadPolls()
        this.setState({pollsError: new Error(res.error)})
      }
    }, err => {
      this.reloadPolls()
      this.setState({pollsError: err})
    })
  }

  handleVote (poll, cand) {
    this.state.pendingVote[poll._id] = cand
    this.forceUpdate()
    this.flushVotes()
  }

  flushVotes () {
    if (this.flushVotesTimeout !== null) {
      clearTimeout(this.flushVotesTimeout)
      this.flushVotesTimeout = null
    }
    if (this.state.login && this.state.login.type === 'voter' && this.state.polls && this.state.polls.length > 0) {
      let votesToFlush = []
      for (let pollId in this.state.pendingVote) {
        if (!this.state.pendingVote.hasOwnProperty(pollId)) continue
        let poll = this.state.polls.find(x => x._id === pollId)
        if (!poll) continue
        if (!poll.vote || poll.vote.votedFor !== this.state.pendingVote[pollId]) {
          this.sendMessage({type: 'vote', pollId, option: this.state.pendingVote[pollId]}).then(res => {
            if (res.error) {
              this.state.votingErrors[pollId] = new Error(res.error)
              this.setFlushVoteTimeout()
            } else {
              delete this.state.votingErrors[pollId]
            }
            this.forceUpdate()
          }, err => {
            this.state.votingErrors[pollId] = err
            this.forceUpdate()
            this.setFlushVoteTimeout()
          })
        } else {
          delete this.state.votingErrors[pollId]
        }
      }
      this.forceUpdate()
    }
  }

  setFlushVoteTimeout () {
    if (this.flushVotesTimeout !== null) {
      this.flushVotesTimeout = setTimeout(() => {
        this.flushVotesTimeout = null
        this.flushVotes()
      })
    }
  }
}

let reactRootElement = document.getElementsByClassName('react-root')[0]

ReactDOM.render(
  <AppMain />,
  reactRootElement
)
