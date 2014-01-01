var app = require('express')()
    , server = require('http').createServer(app)
    , io = require('socket.io').listen(server)
    , fs = require('fs')
    , url = require('url')
    , path = require('path')

server.listen(process.argv[2])
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

io.sockets.on('connection', function (socket) {
    var id = maxID++
    sockets[id] = socket
    // set id of new player
    socket.emit('accept', {id: id, width: width, height: height})
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
            changed: false,
            elongating: 3
        }

    numSnakes++

    // inform new player of snakes
    socket.emit('create', {snakes: snakes, fruit: fruit})

    socket.on('turn', function (params) {
        if (!(id in snakes))
            return

        newDir = (Math.round(Number(params['d']) / 90) * 90).mod(360)
        // either 0, 90, 180, or 27
        if([0, 90, 180, 270].indexOf(newDir) == -1) return
        // not a reversal
        if(newDir == (snakes[id].d + 180).mod(360)) return

        snakes[id].newDir = newDir
    })
    socket.on('disconnect', function (params) {
        socket.broadcast.emit('delete', {id: id})
        delete snakes[id]
    })
})

function pointIsEqual(a, b) {
    return (a.y == b.y && a.x == b.x)
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
            delete snakes[num]
            io.sockets.emit('lose', {id: num})
            numSnakes--
        }
    }
}

var tick = 300
function update() {
    var changed = {}
    for (var num in snakes) {
        var snake = snakes[num]

        // broadcast unpredictable changes
        if (snake.d != snake.newDir ||
            snake.changed) {
            changed[num] = snake
        }

        snake.changed = false
        snake.d = snake.newDir

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
    collision()
    io.sockets.emit('update',
        {
            snakes: changed,
            fruit: fruit
        })
}
setInterval(update, tick)

var spawnFruitInterval = 4000
function spawnFruit() {
    if (fruit.length < numSnakes)
        fruit.push({x: getRandomInt(width), y:getRandomInt(height)})
}
setInterval(spawnFruit, spawnFruitInterval)
