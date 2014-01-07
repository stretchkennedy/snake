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

function Snake(player, pos) {
    if (player.snake) return
    snakeTail = pos
    this.pieces = [{
        x: snakeTail.x,
        y: snakeTail.y
    }]
    this.d = snakeTail.d
    this.newDir = snakeTail.d
    this.changed = true
    this.elongating = 3
    this.died = function() {
        player.snakeDied()
    }
    
    game.numSnakes++
    player.snake = this

    // inform players of new snake
    var newSnakes = {}
    newSnakes[player.id] = player.snake
    io.sockets.emit('create', {snakes: newSnakes})
    player.socket.emit('spawn', {id: player.id})
}
function Player (game, socket) {
    
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
    this.id = game.maxID++
    this.socket = socket
    
    // methods
    this.spawnSnake = function() {
        player.snake = new Snake(player, game.newTail())
    }
    this.snakeDied = function() {
        if(!player.snake) {
            return
        }
        var message
        var kid = player.snake.killer
        killer = game.players[kid]
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
        delete game.players[player.id].snake
        delete player.snake
        game.numSnakes--
    }
    this.disconnected = function (id) {
        io.sockets.emit('left', {id: id})
        delete game.players[id]
        game.numSnakes--
    }
    
    // register player to receive messages
    player.socket.on('turn', function (params) {
        if (!(player.id in game.players)) return

        var newDir = (Math.round(Number(params['d']) / 90) * 90).mod(360)
        // either 0, 90, 180, or 27
        if([0, 90, 180, 270].indexOf(newDir) == -1) return
        // not a reversal
        if(newDir == (player.snake.d + 180).mod(360)) return

        player.snake.newDir = newDir
    })
    player.socket.on('respawn', function (params) {
        if(player.snake) return
        player.spawnSnake()
    })
    player.socket.on('disconnect', function (params) {
        player.disconnected()
        console.log(player.socket.handshake.address.address + ' disconnected')
    })
    player.socket.on('rename', function (params) {
        player.name(params['name'])
    })
    player.socket.on('msg', function (params) {
        io.sockets.emit('msged', { id: player.id, m: S(params['m']).escapeHTML().s })
    })

    // register player with game
    game.players[this.id] = this
    
    // constructor
    this.socket.emit('accept', {id: this.id, width: game.width, height: game.height})
    this.socket.broadcast.emit('joined', {id: this.id})
    this.name('Player ' + this.id)
    this.spawnSnake()
    this.socket.emit('create', {snakes: game.allSnakes(), fruit: game.fruit, names: game.allNames()})
}
function Game(w, h) {
    // properties
    var game = this
    this.players = {}
    this.width = w
    this.height = h
    this.maxID = 0
    this.numSnakes = 0
    this.fruit = []
    
    // methods
    this.allSnakes = function() {
        var snakes = {}
        for (var pid in game.players) {
            snakes[pid] = game.players[pid].snake
        }
        return snakes
    }
    this.allNames = function() {
        var names = {}
        for (var pid in game.players) {
            names[pid] = game.players[pid].name()
        }
        return names
    }
    this.changedSnakes = function() {
        var changed = {}
        for (var pid in game.players) {
            var snake = game.players[pid].snake
            if(snake && snake.changed) {
                changed[pid] = snake
                snake.changed = false
            }
        }
        return changed
    }
    this.newTail = function() {
        var ret =
            {
                x: getRandomInt(game.width),
                y: getRandomInt(game.height),
                d: 0
            }
        return ret
    }
    this.newPlayer = function(socket) {
        return new Player(game, socket)
    }
    // fruit spawning
    function spawnFruitInterval() { return 4000 / Math.sqrt(game.numSnakes + 1) }
    function spawnFruit() {
        if (game.fruit.length < 2 * game.numSnakes) {
            game.fruit.push({x: getRandomInt(game.width), y:getRandomInt(game.height)})
        }
        setTimeout(spawnFruit, spawnFruitInterval())
    }
    setTimeout(spawnFruit, spawnFruitInterval())
    
    // logic
    function updatePosition() {
        for (var pid in game.players) {
            var snake = game.players[pid].snake
            if (!snake) {
                continue
            }
            // broadcast unpredictable changes
            if (snake.d != snake.newDir) {
                snake.changed = true
                snake.d = snake.newDir
            }
            
            // grow snake's head
            var head = snake.pieces[0]
            if (snake.d == 0)
                snake.pieces.unshift({x: (head.x + 1).mod(game.width), y: head.y})
            else if(snake.d == 90)
                snake.pieces.unshift({x: head.x, y: (head.y - 1).mod(game.height)})
            else if(snake.d == 180)
                snake.pieces.unshift({x: (head.x - 1).mod(game.width), y: head.y})
            else if(snake.d == 270)
                snake.pieces.unshift({x: head.x, y: (head.y + 1).mod(game.height)})

            // shorten snake's tail
            if (snake.elongating > 0) {
                snake.elongating -= 1
                snake.changed = true
            }
            else {
                snake.pieces.pop()
            }
        }
    }
    function collision() {
        // collision
        for (var pid1 in game.players) {
            var snake1 = game.players[pid1].snake
            if (!snake1) {
                continue
            }
            // collide fruit with heads
            for (var i = 0; i < game.fruit.length; i++) {
                if (pointIsEqual(snake1.pieces[0], game.fruit[i])) {
                    snake1.elongating += 1
                    snake1.changed = true
                    game.fruit.splice(i, 1)
                }
            }
            for (var pid2 in game.players) {
                var snake2 = game.players[pid2].snake
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
        for (var pid in game.players) {
            var snake = game.players[pid].snake
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
                snakes: game.changedSnakes(),
                fruit: game.fruit
            })
    }
    setInterval(update, tick)
    
    return this
}

var game = new Game(20, 20)

function getRandomInt(max) {
    return Math.floor(Math.random() * (max));
}

io.sockets.on('connection', function (socket) {
    console.log(socket.handshake.address.address + ' connected')
    game.newPlayer(socket)
})
