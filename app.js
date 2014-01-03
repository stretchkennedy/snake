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

server.listen(port)
console.log('listening on port ' + port)
io.set('log level', 1)

Number.prototype.mod = function(n) {
    return ((this%n)+n)%n;
}

function serveFile(req, res, filename) {
    var rs = fs.createReadStream(path.join(__dirname, filename))
    rs.on('error', function (err) {
        res.writeHead(500)
        res.end('Error loading ' + filename)
    })
    rs.pipe(res)
}

function index(req, res) {
    if (process.argv[3] == 'm')
        return serveFile(req, res, 'maint.html')
    else
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

var width = 20
var height = 20

var maxID = 0

var snakes = {}
var sockets = {}
var fruit = []

var numSnakes = 0

function getRandomInt(max) {
    return Math.floor(Math.random() * (max));
}

function newTail() {
    var ret =
        {
            x: getRandomInt(width),
            y: getRandomInt(height),
            d: 0
        }
    return ret
}

function snakeDied(id) {
    io.sockets.emit('die', {id: id})
    delete snakes[id]
    numSnakes--
}

function playerDisconnected(id) {
    io.sockets.emit('left', {id: id})
    if(snakes[id]) {
        delete snakes[id]
        numSnakes--
    }
    delete sockets[id]
}

function spawnSnake(id) {
    if (snakes[id]) return
    
    snakeTail = newTail()
    snakes[id] =
        {
            id: id,
            name: id.toString(),
            pieces:
                [{
                    x: snakeTail.x,
                    y: snakeTail.y
                }],
            d: snakeTail.d,
            newDir: snakeTail.d,
            changed: true,
            elongating: 3
        }

    numSnakes++

    // inform players of new snake
    var newSnakes = {}
    newSnakes[id] = snakes[id]
    io.sockets.emit('create', {snakes: newSnakes})
    sockets[id].emit('spawn', {id: id})
}

io.sockets.on('connection', function (socket) {
    console.log(socket.handshake.address.address + ' connected')

    var id = maxID++
    sockets[id] = socket
    socket.emit('accept', {width: width, height: height})
    
    spawnSnake(id)
    
    // inform new player of existing snakes
    socket.emit('create', {snakes: snakes, fruit: fruit})

    socket.on('turn', function (params) {
        if (!(id in snakes)) return

        newDir = (Math.round(Number(params['d']) / 90) * 90).mod(360)
        // either 0, 90, 180, or 27
        if([0, 90, 180, 270].indexOf(newDir) == -1) return
        // not a reversal
        if(newDir == (snakes[id].d + 180).mod(360)) return

        snakes[id].newDir = newDir
    })
    socket.on('respawn', function (params) {
        if(id in snakes) return
        spawnSnake(id)
    })
    socket.on('disconnect', function (params) {
        playerDisconnected(id)
        console.log(socket.handshake.address.address + ' disconnected')
    })
})


function pointIsEqual(a, b) {
    return (a.y == b.y && a.x == b.x)
}

function updatePosition() {
    for (var num in snakes) {
        var snake = snakes[num]

        // broadcast unpredictable changes
        if (snake.d != snake.newDir) {
            snake.changed = true
            snake.d = snake.newDir
        }
        
        // grow snake's head
        var head = snake.pieces[0]
        if (snake.d == 0)
            snake.pieces.unshift({x: (head.x + 1).mod(width), y: head.y})
        else if(snake.d == 90)
            snake.pieces.unshift({x: head.x, y: (head.y - 1).mod(height)})
        else if(snake.d == 180)
            snake.pieces.unshift({x: (head.x - 1).mod(width), y: head.y})
        else if(snake.d == 270)
            snake.pieces.unshift({x: head.x, y: (head.y + 1).mod(height)})

        // shorten snake's tail
        if (snake.elongating > 0) {
            snake.elongating -= 1
        }
        else {
            snake.pieces.pop()
        }
    }
}

function collision() {
    var bodies = new Array()
    var heads = []
    // precollision
    for (var num in snakes) {
        var snake = snakes[num]
        bodies = bodies.concat(snake.pieces.slice(1))
    }
    // collision
    for (var num in snakes) {
        var snake = snakes[num]
        // collide bodies with heads
        for (var i = 0; i < bodies.length; i++) {
            if (pointIsEqual(snake.pieces[0], bodies[i]))
                snake.dead = true
        }
        // collide heads with heads
        for (var num2 in snakes) {
            if (num == num2)
                continue
            snake2 = snakes[num2]
            if (pointIsEqual(snake.pieces[0], snake2.pieces[0])) {
                snake.dead = true
                snake2.dead = true
            }
        }
        // collide fruit with heads
        for (var i = 0; i < fruit.length; i++) {
            if (pointIsEqual(snake.pieces[0], fruit[i])) {
                snake.elongating += 1
                snake.changed = true
                fruit.splice(i, 1)
            }
        }
    }
    // postcollision
    for (var num in snakes) {
        var snake = snakes[num]
        if (snake.dead) {
            snakeDied(num)
        }
    }
}

function changedSnakes() {
    var changed = {}
    for (var num in snakes) {
        snake = snakes[num]
        if(snake.changed) {
            changed[num] = snake
            snake.changed = false
        }
    }
    return changed
}

var tick = 300
function update() {
    updatePosition()
    collision()
    io.sockets.emit('update',
        {
            snakes: changedSnakes(),
            fruit: fruit
        })
}
setInterval(update, tick)

function spawnFruitInterval() { return 4000 / Math.sqrt(numSnakes + 1) }
function spawnFruit() {
    if (fruit.length < 2 * numSnakes)
        fruit.push({x: getRandomInt(width), y:getRandomInt(height)})
    setTimeout(spawnFruit, spawnFruitInterval())
}
setTimeout(spawnFruit, spawnFruitInterval())
