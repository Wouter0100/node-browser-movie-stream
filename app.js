var http = require('http');
var torrentStream = require('torrent-stream');
var parseRange = require('range-parser');
var fs = require('fs');
var path = require('path');
var pretty = require('prettysize');

// Some settings
var movieFolder = '/tmp/torrent-stream/';

// Objects to save things in
var streams = {}; // Streams, each magnet one
var streamFileKey = {}; // A key, which file is the movie
var streamOpenPipes = {}; // A count of open pipes
var streamStartedSeeding = {}; // The Date.getTime() when no more pipes were open to a stream

// Functions
var createStream = function(magnet) {
    streams[magnet] = torrentStream('magnet:?xt=urn:btih:' + magnet, {
        trackers: [
            'udp://open.demonii.com:1337',
            'udp://tracker.istole.it:80',
            'http://tracker.yify-torrents.com/announce',
            'udp://tracker.publicbt.com:80',
            'udp://tracker.openbittorrent.com:80',
            'udp://tracker.coppersurfer.tk:6969',
            'udp://exodus.desync.com:6969',
            'http://exodus.desync.com:6969/announce'
        ]
    });
    streamOpenPipes[magnet] = 0;
};

// HTTP server
var httpServer = http.createServer();

httpServer.on('request', function(req, res) {
    // Every request...

    var ext = path.extname(req.url);

    if (ext && ext == '.mp4') {  // Check if extension is a mp4 file
        var magnet = path.basename(req.url, path.extname(req.url)).toLowerCase();

        console.log('[HTTP] Magnet: ' + magnet);

        if (!streams[magnet]) { // Check if we have a stream already, when not, create one
            console.log('[HTTP] New magnet');

            createStream(magnet);
        }

        var stream = streams[magnet];

        var startStream = function() { // Stream function
            var file = stream.files[streamFileKey[magnet]];

            var range = req.headers.range;
            range = range && parseRange(file.length, range)[0];

            if (range) { // Is there a range specified by the browser, honor it
                console.log('[STREAM] part...');

                // Write headers to browser
                res.writeHead(206, {
                    'Content-Range': 'bytes ' + range.start + '-' + range.end + '/' + file.length,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': (range.end - range.start) + 1,
                    'Content-Type': 'video/mp4'
                });
            } else {
                console.log('[STREAM] all');

                // Write headers to browser
                res.writeHead(200, {
                    'Content-Length': file.length,
                    'Content-Type': 'video/mp4'
                });
            }

            //Start stream to browser
            console.log('[STREAM] Start stream');
            var piping = file.createReadStream(range).pipe(res, { end: false });
            streamOpenPipes[magnet]++;

            piping.on('error', function() {
                console.log('[STREAM] STREAM ERROR!');
            });

            piping.on('close', function() {
                console.log('[STREAM] Pipe closed for magnet ' + magnet);

                streamOpenPipes[magnet]--;

                if (streamOpenPipes[magnet] == 0) {
                    streamStartedSeeding[magnet] = new Date().getTime();
                }
            });
        };

        if (stream.files.length == 0) { // Check if there are any files ready
            stream.on('ready', function() { // Wait for becoming ready

                // Get the movie out of the files and save it
                stream.files.forEach(function(file, index) {
                    if (path.extname(file.name) == '.mp4') {
                        streamFileKey[magnet] = index;
                    }
                });

                startStream();
            });
        } else {
            startStream();
        }
    }

});

httpServer.listen(8080);

// Seed timer
setInterval(function() {
    console.log('[SEED] Seed timer');

    for(var magnet in streams) {
        if (streams.hasOwnProperty(magnet)) {
            var stream = streams[magnet];
            var file = stream.files[streamFileKey[magnet]];

            console.log('[SEED] Checking magnet ' + magnet);
            console.log('[SEED] Upload: ' + pretty(stream.swarm.uploaded));
            console.log('[SEED] Download: ' + pretty(stream.swarm.downloaded));
            console.log('[SEED] Open pipes: ' + streamOpenPipes[magnet]);

            if (file && streamOpenPipes[magnet] == 0) {
                console.log('[SEED] Download time is ' + (streamStartedSeeding[magnet] + 86400000) + ' >= ' + new Date().getTime());

                if ((streamStartedSeeding[magnet] + 86400000) <= new Date().getTime()) {
                    console.log('[SEED] Waiting time hit');

                    stream.remove(function() {});
                    delete streams[magnet];
                    continue;
                }

                console.log('[SEED] Still seeding magnet');
            }
        }
    }
}, 20000);

// Startup script, add magnets to startup..
fs.readdir(movieFolder, function (err, files) {
    files.filter(function (file) {
        return fs.statSync(movieFolder + file).isDirectory();
    }).forEach(function (file) {
        var magnet = file.toLowerCase();
        console.log('[STARTUP] Found magnet in startup: ' + magnet);
        createStream(magnet);

        var stream = streams[magnet];

        stream.on('ready', function() { // Wait for becoming ready

            // Get the movie out of the files and save it
            stream.files.forEach(function(file, index) {
                if (path.extname(file.name) == '.mp4') {
                    streamFileKey[magnet] = index;
                    console.log('[STARTUP] Saved file for magnet: ' + magnet);
                }
            });
        });
    });
});

