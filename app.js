if(process.env.NODETIME_ACCOUNT_KEY) {
  require('nodetime').profile({
    accountKey: process.env.NODETIME_ACCOUNT_KEY,
    appName: 'sk-node-snake' // optional
  });
}

var app = require('express')()
    , server = require('http').createServer(app)
    , io = require('socket.io').listen(server)
    , fs = require('fs')
    , url = require('url')
    , path = require('path')
    , port = process.env.PORT || 5000
    , S = require('string')

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
    return ((this%n)+n)%n;
}
function pointIsEqual(a, b) {
    return (a.y == b.y && a.x == b.x)
}
function getRandomInt(max) {
    return Math.floor(Math.random() * (max));
}

function Snake(board, player, pos) {
    if (player.snake) return
    var snake = this
    var snakeTail = pos
    this.pieces = [{
        x: snakeTail.x,
        y: snakeTail.y,
        changed: true
    }]
    this.d = snakeTail.d
    this.newDir = snakeTail.d
    this.changed = true
    this.elongating = 3
    this.growing = true
    this.update = function() {
        snake.d = snake.newDir
        
        // grow snake's head
        snake.grow()
        snake.growing = (snake.elongating > 0)
        
        // shorten snake's tail
        if (snake.growing) {
            snake.elongating--
        }
        else {
            snake.pieces.pop()
        }
    }
    this.died = function() {
        player.snakeDied()
    }
    this.forUpdate = function() {
        return {
            head: snake.pieces[0],
            grow: snake.growing
        }
    }
    this.forCreate = function() {
        return {
            pieces: snake.pieces,
        }
    }
    
    this.grow = function() {
        var head = snake.pieces[0]
        if (snake.d == 0)
            snake.pieces.unshift({x: (head.x + 1).mod(board.width), y: head.y})
        else if(snake.d == 90)
            snake.pieces.unshift({x: head.x, y: (head.y - 1).mod(board.height)})
        else if(snake.d == 180)
            snake.pieces.unshift({x: (head.x - 1).mod(board.width), y: head.y})
        else if(snake.d == 270)
            snake.pieces.unshift({x: head.x, y: (head.y + 1).mod(board.height)})
        snake.pieces[0].changed = true
    }
    
    // constructor
    board.numSnakes++
    player.snake = this

    var newSnakes = {}
    newSnakes[player.id] = player.snake.forCreate()
    io.sockets.emit('create', {snakes: newSnakes})
    player.socket.emit('spawn', {id: player.id})
}
function Player (board, socket) {
    
    // private
    var player = this
    var _name
    
    // public
    this.name = function() {
        if (arguments[0]) {
            _name = arguments[0]
            io.sockets.emit('renamed', {
                id: player.id,
                name: _name
            })
        }
        return _name
    }
    this.kills = 0
    this.id = board.maxID++
    this.socket = socket
    
    // methods
    this.spawnSnake = function() {
        player.snake = new Snake(board, player, board.newTail())
    }
    this.snakeDied = function() {
        if(!player.snake) {
            return
        }
        var message
        var kid = player.snake.killer
        killer = board.players[kid]
        if (kid != undefined && kid != player.id) {
            message = {id: player.id, killer: kid}
            killer.kills++
            if (killer.snake) {
                killer.snake.elongating += 1
            }
        }
        else {
            message = {id: player.id}
        }
        io.sockets.emit('die', message)
        delete board.players[player.id].snake
        delete player.snake
        board.numSnakes--
    }
    this.disconnected = function () {
        io.sockets.emit('left', {id: player.id})
        delete board.players[player.id]
        board.numSnakes--
    }
    
    // register player to receive messages
    this.socket.on('turn', function (params) {
        if (!player.snake) {
            return
        }

        var newDir = (Math.round(Number(params['d']) / 90) * 90).mod(360)
        // either 0, 90, 180, or 27
        if([0, 90, 180, 270].indexOf(newDir) == -1) return
        // not a reversal
        if(newDir == (player.snake.d + 180).mod(360)) return

        player.snake.newDir = newDir
    })
    this.socket.on('respawn', function (params) {
        if(player.snake) return
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

    // register player with board
    board.players[this.id] = this
    
    // constructor
    this.socket.emit('accept', {id: this.id, width: board.width, height: board.height})
    this.socket.broadcast.emit('joined', {id: this.id})
    this.name('Player ' + this.id)
    this.spawnSnake()
    this.socket.emit('create', 
        {
            snakes: board.snakesForCreate(), 
            fruit: board.fruit, 
            names: board.allNames()
        }
    )
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
        var ret =
            {
                x: getRandomInt(board.width),
                y: getRandomInt(board.height),
                d: 0
            }
        return ret
    }
    this.newPlayer = function(socket) {
        return new Player(board, socket)
    }
    // fruit spawning
    function spawnFruitInterval() { return 4000 / Math.sqrt(board.numSnakes + 1) }
    function spawnFruit() {
        if (board.fruit.length < 2 * board.numSnakes) {
            board.fruit.push({x: getRandomInt(board.width), y:getRandomInt(board.height)})
        }
        setTimeout(spawnFruit, spawnFruitInterval())
    }
    setTimeout(spawnFruit, spawnFruitInterval())
    
    // logic
    function updatePosition() {
        for (var pid in board.players) {
            var snake = board.players[pid].snake
            if (snake) {
                snake.update()
            }
        }
    }
    function collision() {
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
    
    // main loop
    var tick = 300
    function update() {
        updatePosition()
        collision()
        io.sockets.emit('update',
            {
                snakes: board.snakesForUpdate(),
                fruit: board.fruit
            })
    }
    setInterval(update, tick)
    
    return this
}

var board = new Board(20, 20)

io.sockets.on('connection', function (socket) {
    console.log(socket.handshake.address.address + ' connected')
    board.newPlayer(socket)
})
