'use strict'

require('@babel/polyfill')
require('fetch-polyfill')

const React = require('react')
const ReactDOM = require('react-dom')

const TicketTex = require('raw-loader!../voterticket.tex')

// Polyfill
window.requestIdleCallback = window.requestIdleCallback || (func => setTimeout(func, 1000))
window.cancelIdleCallback = window.cancelIdleCallback || (id => clearTimeout(id))

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
      votingErrors: {},
      presentingPoll: null,
      secretUrl: false
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
    this.handleExitPresentation = this.handleExitPresentation.bind(this)
    this.handleShowOnlyN = this.handleShowOnlyN.bind(this)
    this.handlePrintTickets = this.handlePrintTickets.bind(this)
  }

  initSocket () {
    if (this.socketIniting) return this.socketIniting
    this.socketIniting = new Promise((resolve, reject) => {
      console.log('initSocket')
      if (this.state.socket) {
        if (this.state.socket.readyState === WebSocket.OPEN) return void resolve()
      }
      this.setState({socketState: 'disconnected'})
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
          console.log('Socket ready')
          this.setState({socketState: 'ready', socketError: null})
          if (this.latencySetTimeout !== null) clearTimeout(this.latencySetTimeout)
          this.testLatency()
          if (this.state.login && this.state.login.secret) {
            this.sendMessage({type: 'login', secret: this.state.login.secret, role: this.state.login.type}).then(res => {
              if (res.error) {
                this.handleLogout()
              }
              if (this.state.presentingPoll) {
                this.sendMessage({type: 'poll-subscribe', id: this.state.presentingPoll.poll._id}).then(res => {
                  if (res.error) {
                    this.handleExitPresentation()
                  }
                }, err => {
                  this.handleExitPresentation()
                })
              }
              console.log('Socket login ok')
              resolve()
            }, err => {
              this.socketTerminateWithError(err)
              console.log('Socket login not ok')
              reject(err)
            })
          } else {
            resolve()
          }
        })
        let errored = false
        socket.addEventListener('error', evt => {
          console.log('Socket error')
          let socketError = evt.error
          if (!socketError) socketError = new Error('Network error')
          reject(socketError)
          if (this.state.socketState === 'ready') {
            this.socketTerminateWithError(socketError)
          } else {
            setTimeout(() => this.initSocket(), 100)
          }
          errored = true
        })
        socket.addEventListener('close', evt => {
          console.log('Socket close')
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
            } else if (msg.type === 'presentationPush') {
              let pollId = msg.meta._id
              if (this.state.presentingPoll && this.state.presentingPoll.poll._id === pollId) {
                this.state.presentingPoll.data = msg
                this.state.presentingPoll.lastReceive = Date.now()
                this.setPresentationPushTimeoutChecker()
                this.forceUpdate()
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
        reject()
      }
    }).finally(() => {
      this.socketIniting = null
    })
    return this.socketIniting
  }

  socketTerminateWithError (err) {
    if (this.state.socketState !== 'ready') return
    let socket = this.state.socket
    this.setState({socketState: 'disconnected', socketError: err, socket: null})
    try {
      socket.close(0, 'error occured.')
    } catch (e) {}
    setTimeout(() => {
      this.initSocket()
    }, 100)
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

  sendMessage (msg) {
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
    let queryMatch = window.location.href.match(/\?s=.+$/)
    this.initSocket().then(() => {
      if (queryMatch) {
        let secret = decodeURIComponent(queryMatch[0].substr(3))
        this.setState({
          loginning: {
            section: 'voter',
            secretInput: secret
          }
        })
        this.handleLogin()
      }
    })
    if (queryMatch) {
      this.setState({secretUrl: true})
    }
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
        <div className={'topbar' + (this.state.presentingPoll ? ' presenting' : '')}>
          <div className='logo'>
            <b>Leaf</b>Vote
          </div>
          <div className='dash'>&mdash;</div>
          {this.getConnectionStatusUI()}
          {this.state.presentingPoll === null ? [
            this.getLoggedInAs(),
            this.state.login ? <div className='logout' onClick={this.handleLogout}>Log out</div> : null
          ] : [
            (this.state.presentingPoll.style === 2 ? (
              <div className='showonly3' onClick={this.handleShowOnlyN}>
                Show only 1
              </div>
            ) : null),
            (
              <div className='exitpresentation' onClick={this.handleExitPresentation}>
                Exit presentation
              </div>
            )
          ]}
        </div>
        {this.state.login === null && !this.state.secretUrl ? (
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
        {!this.state.login && this.state.secretUrl ? (
          <div className='view login'>
            Logging you in&hellip;
          </div>
        ) : null}
        {this.state.login && this.state.login.type === 'manager' && !this.state.presentingPoll ? (
          <div className='view manager' key='view-manager'>
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
                this.state.polls === null ? <div className='loading'>Loading your polls&hellip;</div> : null
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
                        <div className='btn' onClick={evt => this.handlePresentPoll(poll)}>
                          Present
                        </div>
                        <div className='btn' onClick={evt => this.handlePresentPoll(poll, 2)}>
                            Present (2)
                      </div>
                      </div>
                    ) : (
                      <div className='bottom'>
                        {poll.voters && !poll.voters.opDoing ? [
                          <div key={-1} className='btn' onClick={evt => this.handlePollCloseEditing(poll)}>Close</div>,
                          <input key={0} className='opNumber' type='number' min={1} value={poll.voters.opNumber} onChange={evt => this.handleVoterOpNumberChange(poll, evt.target.value)} />,
                          <div key={1} className='btn' onClick={evt => this.handleAddVoters(poll)}>Add</div>,
                          <div key={2} className='btn' onClick={evt => this.handleImportVoter(poll)}>Import from poll</div>,
                          <div key={3} className='btn' onClick={evt => this.handleRemoveAllVoters(poll)}>Remove all</div>,
                          <input key={4} className='filter' type='text' placeholder='(filter)' value={poll.voters.filter || ''} onChange={evt => this.handleVoterFilterChange(poll, evt.target.value)} />,
                          <div key={5} className={'btn' + (() => {
                            if (poll.printVotingTicket) {
                              if (poll.printVotingTicket.loading) {
                                return ' disabled'
                              } else if (poll.printVotingTicket.error) {
                                return ' error'
                              }
                            }
                            return ''
                          })()} onClick={evt => this.handlePrintTickets(poll)}>
                            {
                              poll.printVotingTicket ? (
                                poll.printVotingTicket.loading ? "Printing..." : (
                                  poll.printVotingTicket.error ? "Error: " + poll.printVotingTicket.error : (
                                    poll.printVotingTicket.pdfUrl ? "Open pdf" : "Print voting tickets"
                                  )
                                )
                              ) : "Print voting tickets"
                            }
                          </div>,
                          poll.printVotingTicket && poll.printVotingTicket.error ? (
                            <div key={6} className='btn' onClick={evt => this.handleExportTex(poll)}>Export tex and generate pdf yourself</div>
                          ) : null
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
        {this.state.presentingPoll !== null ? this.getPresentRender() : null}
      </div>
    )
  }

  getPresentRender () {
    if (this.state.presentingPoll === null) return null
    let presentingPoll = this.state.presentingPoll
    if (presentingPoll.style === 1) {
      return (
        <div className='view presentation' key='view-manager'>
          <div className='label'>
          {presentingPoll.data ? presentingPoll.data.meta.label : presentingPoll.poll.label}
          </div>
          {(data => {
            if (!data) {
              return (
                <div className='loading'>
                  Awaiting information from server.
                </div>
              )
            }
            return [
              data.meta.active ? (
                <div className='instructions' key={0}>
                  <b>Voting Instructions</b>
                  <p>
                    You should have received a voting ticket with a QR code on it. Scan the code to login.
                    If you are unable to scan, visit the following website and enter the secret shown on the paper.
                  </p>
                  <div className='url'>
                    {window.location.hostname}
                  </div>
                </div>
              ) : (
                <div className='nonactive' key={0}>
                  The poll is currently closed, which means nobody can vote.
                </div>
              ),
              this.makeChart(data, 1)
            ]
          })(presentingPoll.data)}
        </div>
      )
    } else if (presentingPoll.style === 2) {
      let maxVote = null
      return (
        <div className='view presentation2' key='view-manager'>
          <div className='label'>
            <div className='title'>{presentingPoll.data ? presentingPoll.data.meta.label : presentingPoll.poll.label}</div>
            {presentingPoll.data ? (
              <div className='desc'>{presentingPoll.data.results.length} / {presentingPoll.poll.options.length} candidate received votes.</div>
            ) : (
              <div className='desc'>Awaiting information from server.</div>
            )}
          </div>
          <div className='results'>
            {presentingPoll.data && presentingPoll.data.results ? (
              presentingPoll.data.results.sort((a, b) => Math.sign(b.count - a.count)).map((item, i) => {
                if (i >= 1 && presentingPoll.showOnlyN) {
                  return null
                }
                if (maxVote == null) maxVote = item.count
                return (
                  <div className='candidate' key={item.candidate}>
                    <div className='nameline'>
                      <div className='name'>{item.candidate}</div>
                      <div className='count'>{item.count}</div>
                    </div>
                    <div className='bar'>
                      <div className='fill' style={{width: ((item.count / maxVote) * 100) + '%'}} />
                    </div>
                  </div>
                )
              })
            ) : null}
            {presentingPoll.data && presentingPoll.data.results &&
              presentingPoll.data.results.length > 3 && presentingPoll.showOnlyN ? (
              <div className='showingonly3'>The rest {presentingPoll.data.results.length - 1} omitted.</div>
            ) : null}
          </div>
        </div>
      )
    }
  }

  handleShowOnlyN () {
    let presentingPoll = this.state.presentingPoll
    if (presentingPoll && presentingPoll.style === 2) {
      presentingPoll.showOnlyN = !presentingPoll.showOnlyN
      this.forceUpdate()
    }
  }

  makeChart (data, key) {
    if (!data || !data.results) return null
    let results = data.results
    let options = data.meta.options
    let cWidth = window.innerWidth * 0.8
    const hSpace = 60
    let cHeight = options.length * hSpace
    let xBarStart = 200
    let dataMax = 0
    let sum = 0
    for (let r of results) {
      if (r.count > dataMax) dataMax = r.count
      sum += r.count
    }
    dataMax = Math.max(dataMax, 10)
    dataMax += Math.sqrt(dataMax)
    const rightMargin = 100
    let xScale = (cWidth - xBarStart - rightMargin) / dataMax
    const hBar = 20
    let optCounts = {}
    for (let o of options) {
      optCounts[o] = 0
    }
    for (let r of results) {
      optCounts[r.candidate] = r.count
    }
    return (
      <div className='chart' key={key} style={{
        width: cWidth + 'px',
        height: cHeight + 'px'
      }}>
        {options.map((opt, optI) => {
          let sY = optI * hSpace
          let barWidth = optCounts[opt] * xScale
          return [
            <div className='label' key={opt + '_label'} style={{
              top: sY + 'px',
              left: '0',
              width: (xBarStart - 20) + 'px',
              height: hSpace + 'px',
              lineHeight: hSpace + 'px'
            }}>
              {opt}
            </div>,
            <div className='bar' key={opt + '_bar'} style={{
              top: (sY + hSpace/2 - hBar/2) + 'px',
              left: xBarStart + 'px',
              height: hBar + 'px',
              width: barWidth + 'px',
              backgroundColor: '#fff'
            }} />,
            <div className='value' key={opt + '_value'} style={{
              top: sY + 'px',
              left: (xBarStart + barWidth) + 'px',
              right: '0',
              height: hSpace + 'px',
              lineHeight: hSpace + 'px'
            }}>{optCounts[opt]}</div>
          ]
        })}
        <div className='fill' key={'leftline'} style={{
          top: '0',
          height: cHeight + 'px',
          left: (xBarStart - 1) + 'px',
          width: '1px'
        }} />
        <div className='fill' key={'halfline'} style={{
          top: '0',
          height: cHeight + 'px',
          left: (xBarStart + (sum / 2) * xScale) + 'px',
          width: '0',
          opacity: 0.5,
          backgroundColor: 'transparent',
          borderRight: 'dashed 1px white'
        }} />
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
      this.setState({secretUrl: false})
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
      this.setState({secretUrl: false})
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
      if (this.state.presentingPoll && this.state.presentingPoll.lastReceive) {
        let lastReceiveSec = Math.round((Date.now() - this.state.presentingPoll.lastReceive) / 100) / 10
        this.updateLater()
        return <div className='connection ready'>Last update: {lastReceiveSec}s ago</div>
      }
      return <div className='connection ready'>{this.state.latency || '✓'}</div>
    }
    return <div className='connection'>{this.state.socketState}</div>
  }

  updateLater () {
    if (!this.updateLaterTimeout) {
      this.updateLaterTimeout = setTimeout(() => {
        this.updateLaterTimeout = null
        this.forceUpdate()
      }, 100)
    }
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
      loginning: null,
      presentingPoll: null
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

  handlePresentPoll (poll, style = 1) {
    this.setState({
      presentingPoll: {
        poll,
        data: null,
        style
      }
    })
    this.sendMessage({type: 'poll-subscribe', id: poll._id})
    this.setPresentationPushTimeoutChecker()
  }

  setPresentationPushTimeoutChecker () {
    if (this.presentationPushTimeout) clearTimeout(this.presentationPushTimeout)
    this.presentationPushTimeout = setTimeout(() => {
      this.presentationPushTimeout = null
      if (!this.state.presentingPoll) return
      this.socketTerminateWithError(new Error('long time no data from server'))
    }, 5000)
  }

  handleExitPresentation () {
    this.setState({
      presentingPoll: null
    })
    this.sendMessage({type: 'poll-unsubscribe'})
  }

  handleExportTex (poll) {
    if (!poll.voters || !poll.voters.voters) return
    let voters = poll.voters.voters.filter(x => x.indexOf(poll.voters.filter || '') >= 0)
    let t = ''
    const iX = 4, iY = 264
    let cX = iX, cY = iY
    const xInc = 82, yInc = 31
    const pageW = 210, pageH = 297
    let currentPageTex = ''
    for (let secret of voters) {
      currentPageTex += `\\begin{scope}[shift={(${cX}mm,${cY}mm)}]\n` +
                        `  \\slitcontent{${secret}}{${encodeURIComponent(secret).replace(/%/g, '\\%')}}\n` +
                        `\\end{scope}\n`
      if (cX + xInc*2 < pageW) {
        cX += xInc
      } else {
        cX = iX
        if (cY - yInc > 0) {
          cY -= yInc
        } else {
          cY = iY
          t += '\\pg{\n'
          t += currentPageTex.replace(/^/gm, '  ').replace(/\n  $/, '\n')
          t += '}%\n'
          currentPageTex = ''
        }
      }
    }
    if (currentPageTex.trim().length > 0) {
      t += '\\pg{\n'
      t += currentPageTex.replace(/^/gm, '  ').replace(/\n  $/, '\n')
      t += '}%\n'
      currentPageTex = ''
    }
    let result = TicketTex.replace(/^\s+%%%%%%% PLACEHOLDER %%%%%%%$/m, t.replace(/^/gm, '  '))
    let url = 'data:text/plain,' + encodeURIComponent(result)
    window.open(url)
  }

  handlePrintTickets (poll) {
    if (poll.printVotingTicket) {
      if (!poll.printVotingTicket.loading) {
        if (poll.printVotingTicket.pdfUrl) {
          window.open(poll.printVotingTicket.pdfUrl)
          poll.printVotingTicket = null
          this.forceUpdate()
          return
        }
      } else {
        return
      }
    }
    if (!poll.voters || !poll.voters.voters) return
    let voters = poll.voters.voters.filter(x => x.indexOf(poll.voters.filter || '') >= 0)
    let printVotingTicket = {
      loading: true
    }
    poll.printVotingTicket = printVotingTicket
    this.forceUpdate()
    this.sendMessage({
      type: 'printTickets',
      voters
    }).then(res => {
      if (poll.printVotingTicket != printVotingTicket) return
      printVotingTicket.loading = false
      if (res.error) {
        printVotingTicket.error = res.error
        this.forceUpdate()
        return
      }
      printVotingTicket.pdfUrl = res.url
      this.forceUpdate()
    }, err => {
      if (poll.printVotingTicket != printVotingTicket) return
      printVotingTicket.loading = false
      printVotingTicket.error = err
      this.forceUpdate()
    })
  }
}

let reactRootElement = document.getElementsByClassName('react-root')[0]

ReactDOM.render(
  <AppMain />,
  reactRootElement
)
