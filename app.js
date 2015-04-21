if(process.env.NODETIME_ACCOUNT_KEY) {
  require('nodetime').profile({
    accountKey: process.env.NODETIME_ACCOUNT_KEY,
    appName: 'sk-node-snake' // optional
  })
}

var app = require('express')()
, server = require('http').createServer(app)
, io = require('socket.io').listen(server)
, fs = require('fs')
, url = require('url')
, path = require('path')
, port = process.env.PORT || 5000
, S = require('string')
, _ = require('underscore')

server.listen(port)
console.log('listening on port ' + port)
io.set('log level', 1)

function serveFile(req, res, filename) {
  var rs = fs.createReadStream(path.join(__dirname, filename))
  rs.on('error', function (err) {
    res.writeHead(500)
    res.end('Error loading ' + filename)
  })
  rs.pipe(res)
}

function index(req, res) {
  return serveFile(req, res, 'index.html')
}

app.get('/', index)
app.get('/index.html', index)
app.get('/index.htm', index)

app.get('/jquery/jquery.min.js', function (req, res) {
  return serveFile(req, res, path.join('node_modules', 'jquery', 'dist', 'jquery.min.js'))
})
app.get('/jquery/jquery.min.map', function (req, res) {
  return serveFile(req, res, path.join('node_modules', 'jquery', 'dist', 'jquery.min.map'))
})
app.get('/style.css', function (req, res) {
  return serveFile(req, res, 'style.css')
})
app.get('/jquery/jquery.caret.js', function (req, res) {
  return serveFile(req, res, 'jquery.caret.js')
})

Number.prototype.mod = function(n) {
  return ((this%n)+n)%n
}
function pointIsEqual(a, b) {
  return (a.y == b.y && a.x == b.x)
}
function getRandomInt(max) {
  return Math.floor(Math.random() * max)
}

_.extend(Snake.prototype, {
  d: 0,
  pieces: [],
  _newDir: 0,
  changed: true,
  elongating: 3,
  growing: true,
  player: null,
  board: null,

  update: function() {
    this.d = this.newDir()

    // grow this's head
    this.grow()
    this.growing = (this.elongating > 0)

    // shorten this's tail
    if (this.growing) {
      this.elongating--
    }
    else {
      this.pieces.pop()
    }
  },
  nearHead: function() {
    var head = this.pieces[0]
    return [
      { y: (head.y + 1).mod(this.board.height), x: head.x },
      { y: (head.y - 1).mod(this.board.height), x: head.x },
      { y: head.y, x: (head.x + 1).mod(this.board.width) },
      { y: head.y, x: (head.x - 1).mod(this.board.width) }
    ]
  },
  died: function() {
    this.player.snakeDied()
  },
  forUpdate: function() {
    return {
      head: this.pieces[0],
      grow: this.growing
    }
  },
  forCreate: function() {
    return {
      pieces: this.pieces,
    }
  },
  roundDirection: function(dir) {
    return (Math.round(dir / 90) * 90).mod(360)
  },
  newDir: function(dir) {
    if (dir != undefined) {
      var newDir = this.roundDirection(dir)
      // either 0, 90, 180, or 270
      if([0, 90, 180, 270].indexOf(newDir) == -1) return
      // not a reversal
      if(newDir == (this.d + 180).mod(360)) return
      this._newDir = newDir
    }
    return this._newDir
  },
  grow: function() {
    var next = this.nextPiece(this.d)
    if (next) {
      this.pieces.unshift(next)
      next.changed = true
    }
  },
  nextPiece: function(dir) {
    dir = this.roundDirection(dir)
    var head = this.pieces[0]
    if (dir === 0)
      return {x: (head.x + 1).mod(this.board.width), y: head.y}
    else if(dir === 90)
      return {x: head.x, y: (head.y - 1).mod(this.board.height)}
    else if(dir === 180)
      return {x: (head.x - 1).mod(this.board.width), y: head.y}
    else if(dir === 270)
      return {x: head.x, y: (head.y + 1).mod(this.board.height)}
  }
})
function Snake(board, player, pos) {
  if (player.snake) return
  var snake = this
  var snakeTail = pos
  this.pieces = [{
    x: snakeTail.x,
    y: snakeTail.y,
    changed: true
  }]
  this.player = player
  this.board = board
  player.snake = this
  board.numSnakes++
  this.d = snakeTail.d
  this.newDir(snakeTail.d)
}

_.extend(Player.prototype, {
  name: null,
  id: null,
  board: null,
  kills: null,
  deaths: null,


  afterUpdate: function() {
    /* do nothing */
  },
  name: function() {
    if (arguments[0]) {
      this._name = arguments[0]
      io.sockets.emit('renamed', {
        id: this.id,
        name: this._name
      })
    }
    return this._name
  },
  spawnSnake: function() {
    this.snake = new Snake(this.board, this, this.board.newTail())

    var newSnakes = {}
    newSnakes[this.id] = this.snake.forCreate()
    io.sockets.emit('create', {
      snakes: newSnakes
    })
  },
  snakeDied: function() {
    if(!this.snake) {
      return
    }
    var message
    var kid = this.snake.killer
    killer = this.board.players[kid]
    if (kid != undefined && kid != this.id) {
      message = {id: this.id, killer: kid}
      killer.kills++
      if (killer.snake) {
        killer.snake.elongating += 1
      }
    }
    else {
      message = {id: this.id}
    }
    this.snake.deaths++
    io.sockets.emit('die', message)
    delete this.board.players[this.id].snake
    delete this.snake
    this.board.numSnakes--
    return message
  },
  connect: function() {
    this.name(this._name)
    io.sockets.emit('joined', {id: this.id})
    this.spawnSnake()
    return this
  },
  disconnected: function () {
    io.sockets.emit('left', {id: this.id})
    if (this.snake) {
      this.board.numSnakes--
    }
    delete this.board.players[this.id]
  }
})
function Player (board) {
  this.board = board
  this.id = this.board.maxID++
  this.kills = 0
  this._name = 'Bot ' + this.id
  this.board.players[this.id] = this
}


_.extend(AIPlayer.prototype, Player.prototype, {
  afterUpdate: function() {
    this._unsafe = null
    if (!this.snake) {
      this.spawnSnake()
      return
    }

    // pick a random direction
    var prospect = this.newDir || 0
    if (!getRandomInt(3)) {
      prospect = this.snake.roundDirection(getRandomInt(360))
    }

    // get fruit if it's adjacent
    var change = 0
    while (change < 360 &&
	       !this.board.hasFruit(this.snake.nextPiece(prospect + change))) {
      change += 90
    }
    prospect += change

    // keep turning until safe or back at the start
    change = 0
    while (change < 360 &&
	       !this.isSafe(this.snake.nextPiece(prospect + change))) {
      change += 90
    }
    prospect += change

    // go in the chosen direction
    this.snake.newDir(prospect)
  },
  isSafe: function(piece) {
    this._unsafe = this._unsafe || this.board.headAreasOfOtherSnakes(this.id)

    return this.board.isSafe(piece) && _.some(this._unsafe, function(other_piece) {
      if (!other_piece) {
	    return false
      }

      return pointIsEqual(piece, other_piece)
    })
  }
})
function AIPlayer (board) {
  Player.apply(this, arguments)
}

_.extend(AUPlayer.prototype, Player.prototype, {
  afterUpdate: function() {
    if (!this.snake) {
      this.spawnSnake()
      return
    }
    if (getRandomInt(2)) {
      this.snake.newDir(getRandomInt(360))
    }
  }
})
function AUPlayer (board) {
  Player.apply(this, arguments)
}

_.extend(HumanPlayer.prototype, Player.prototype, {
  socket: null,
  spawnSnake: function() {
    Player.prototype.spawnSnake.apply(this, arguments)
    this.socket.emit('spawn', {
      id: this.id
    })
  },
  connect: function() {
    this.socket.emit('accept', {
      id: this.id,
      width: this.board.width,
      height: this.board.height
    })
    this.socket.emit('create', {
      snakes: this.board.snakesForCreate(),
      fruit: this.board.fruit,
      names: this.board.allNames()
    })

    var that = this
    this.socket.on('name', function(params) {
      that._name = params['name']
      Player.prototype.connect.apply(that, arguments)
    })
    this
  }
})
function HumanPlayer (board, socket) {
  Player.apply(this, arguments)
  this.socket = socket
  this._name = 'Player ' + this.id

  // register player to receive messages
  var player = this
  this.socket.on('turn', function (params) {
    if (!player.snake) {
      return
    }
    player.snake.newDir(Number(params['d']))
  })
  this.socket.on('respawn', function (params) {
    if(player.snake || player.name() === undefined) return
    player.spawnSnake()
  })
  this.socket.on('disconnect', function (params) {
    player.disconnected()
    console.log(player.socket.handshake.address.address + ' disconnected')
  })
  this.socket.on('rename', function (params) {
    player.name(params['name'])
  })
  this.socket.on('msg', function (params) {
    io.sockets.emit('msged', { id: player.id, m: S(params['m']).escapeHTML().s })
  })
}

function Board(w, h) {
  // properties
  var board = this
  this.players = {}
  this.width = w
  this.height = h
  this.maxID = 0
  this.numSnakes = 0
  this.fruit = []

  // methods
  this.hasFruit = function(piece) {
    return _.some(board.fruit, function(fruit) {
      return pointIsEqual(piece, fruit)
    })
  }
  this.headAreasOfOtherSnakes = function(skip_id) {
    var unsafe = []
    for (pid in board.players) {
      var snake = board.players[pid].snake
      if (!snake || pid === skip_id) {
        continue
      }
      unsafe = unsafe.concat(snake.nearHead())
    }
    return unsafe
  }
  this.invalidateSafety = function() {
    board._safeSpaces = null
    board._safeGrid = null
  }
  this._safeSpaces
  this.safeSpaces = function() {
    if (board._safeSpaces) {
      return board._safeSpaces
    }

    var grid = board.safeGrid()
    board._safeSpaces = []

    // retrieve safe spaces
    for (var x = 0; x < board.width; x++) {
      for (var y = 0; y < board.height; y++) {
        if (grid[x][y]) {
          board._safeSpaces.push({
            x: x,
            y: y
          })
        }
      }
    }

    return board._safeSpaces
  }
  this._safeGrid
  this.safeGrid = function() {
    if (board._safeGrid) {
      return board._safeGrid
    }

    // find unsafe spaces
    var unsafe = []
    for (pid in board.players) {
      var snake = board.players[pid].snake
      if (!snake) {
        continue
      }
      unsafe = unsafe.concat(snake.pieces)
    }

    // init board._safeGrid
    board._safeGrid = new Array(board.width)
    for (var x = 0; x < board.width; x++) {
      board._safeGrid[x] = new Array(board.height)
      for (var y = 0; y < board.height; y++) {
        board._safeGrid[x][y] = true
      }
    }

    // mark unsafe spaces in board._safeGrid
    for (var i = 0; i < unsafe.length; i++) {
      var u = unsafe[i]
      board._safeGrid[u.x][u.y] = false
    }

    return board._safeGrid
  }
  this.getSafeSpace = function() {
    var safeSpaces = board.safeSpaces()
    if (!safeSpaces || safeSpaces.length == 0) {
      return {
        x: getRandomInt(board.width),
        y: getRandomInt(board.height),
      }
    }
    else {
      return safeSpaces[getRandomInt(safeSpaces.length)]
    }
  }
  this.isSafe = function(point) {
    if (!point ||
	    point.x >= board.width || point.x < 0 ||
	    point.y >= board.height || point.y < 0 ||
	    !board.safeGrid()[point.x][point.y]) {
      return false
    }
    return true
  }
  this.allNames = function() {
    var names = {}
    for (var pid in board.players) {
      names[pid] = board.players[pid].name()
    }
    return names
  }
  this.snakesForCreate = function() {
    var snakes = {}
    for (var pid in board.players) {
      var snake = board.players[pid].snake
      if(snake) {
        snakes[pid] = snake.forCreate()
      }
    }
    return snakes
  }
  this.snakesForUpdate = function() {
    var changed = {}
    for (var pid in board.players) {
      var snake = board.players[pid].snake
      if(snake) {
        changed[pid] = snake.forUpdate()
      }
    }
    return changed
  }
  this.newTail = function() {
    var safe = board.getSafeSpace()
    var ret =
        {
          x: safe.x,
          y: safe.y,
          d: 0
        }
    return ret
  }
  this.newHumanPlayer = function(socket) {
    return new HumanPlayer(board, socket)
  }
  this.newAIPlayer = function() {
    return new AIPlayer(board)
  }
  this.newAUPlayer = function() {
    return new AUPlayer(board)
  }
  this.beforeUpdate = function() {}
  this.update =  function() {
    // invalidate safe spawning spaces
    board.invalidateSafety()
    board.updatePosition()
    board.collision()

    io.sockets.emit('update', {
      snakes: board.snakesForUpdate(),
      fruit: board.fruit
    })
  }
  this.afterUpdate = function() {
    for (var pid in board.players) {
      board.players[pid].afterUpdate()
    }
  }
  // fruit spawning
  this.spawnFruitInterval = function() { return 4000 / Math.sqrt(board.numSnakes + 1) }
  this.spawnFruit = function() {
    if (board.fruit.length < 2 * board.numSnakes) {
      board.fruit.push(board.getSafeSpace())
    }
    board.setFruitTimeout()
  }
  this.setFruitTimeout = function() {
    setTimeout(function() {
      board.spawnFruit()
    }, board.spawnFruitInterval())
  }
  // logic
  this.updatePosition = function() {
    for (var pid in board.players) {
      var snake = board.players[pid].snake
      if (snake) {
        snake.update()
      }
    }
  }
  this.collision = function() {
    // collision
    for (var pid1 in board.players) {
      var snake1 = board.players[pid1].snake
      if (!snake1) {
        continue
      }
      // collide fruit with heads
      for (var i = 0; i < board.fruit.length; i++) {
        if (pointIsEqual(snake1.pieces[0], board.fruit[i])) {
          snake1.elongating += 1
          board.fruit.splice(i, 1)
        }
      }
      for (var pid2 in board.players) {
        var snake2 = board.players[pid2].snake
        if (!snake2) {
          continue
        }
        // collide bodies with heads
        pieces2 = snake2.pieces.slice(1)
        for (var i = 0; i < pieces2.length; i++) {
          if (pointIsEqual(snake1.pieces[0], pieces2[i])) {
            snake1.dead = true
            snake1.killer = pid2
          }
        }
        // stop a snake colliding with its own head
        if (pid1 == pid2) {
          continue
        }
        // collide heads with heads
        if (pointIsEqual(snake1.pieces[0], snake2.pieces[0])) {
          snake1.dead = true
          snake1.killer = pid2
        }
      }
    }
    // postcollision
    for (var pid in board.players) {
      var snake = board.players[pid].snake
      if (snake && snake.dead) {
        snake.died()
      }
    }
  }

  // fruit loop
  this.setFruitTimeout()

  // main loop
  var tick = 300
  setInterval(function () {

    board.beforeUpdate()
    board.update()
    board.afterUpdate()

  }, tick)
}

var board = new Board(40, 40)

io.sockets.on('connection', function (socket) {
  console.log(socket.handshake.address.address + ' connected')
  board.newHumanPlayer(socket).connect()
})

for(var i = 0; i < 6; i++) {
  board.newAIPlayer().connect()
}
for(var i = 0; i < 2; i++) {
  board.newAUPlayer().connect()
}
