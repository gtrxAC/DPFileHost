const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto').webcrypto;
const jadmaker2 = require('./jadmaker2');

function getHost(req, res, next) {
    res.locals.host = req.get('host');  // you can replace this with your own domain if necessary
    next();
}

const router = express.Router();

const rateLimits = new Map();

const uploadDir = path.join(__dirname, 'uploads');
try {
    fs.mkdirSync(uploadDir);
}
catch (e) {}

function generateFileID() {
    const t9KeyFirstLetters = ['a', 'd', 'g', 'j', 'm', 'p', 't', 'w'];
    const existing = fs.readdirSync(uploadDir);
    
    let randArr = new Uint8Array(1);
    while (true) {
        let id = '';
        let lastLetter = '';

        // generate a 6-character ID where each letter is the first letter of a key on a T9 keypad, and the same letter cannot appear twice in a row
        while (id.length < 6) {
            crypto.getRandomValues(randArr);
            const letter = t9KeyFirstLetters[randArr[0]%8];
            if (letter == lastLetter) continue;

            id += letter;
            lastLetter = letter;
        }

        // check if any existing file has the same ID
        const idCheck = new RegExp(`_${id}_\\d+$`, 'g');
        if (existing.some(f => idCheck.test(f))) {
            continue;
        }
        return id;
    }
}

function oneHourFromNow() {
    const result = new Date();
    result.setHours(result.getHours() + 1);
    return result;
}

// Cleanup expired files on startup and every 10 min
function cleanup() {
    const files = fs.readdirSync(uploadDir);

    files.forEach(f => {
        const nameParts = f.split('_');
        const expires = Number(nameParts[nameParts.length - 1]);
        if (expires < Date.now()) fs.rm(uploadDir + "/" + f, () => {});
    })
}
cleanup();
setInterval(cleanup, 10*60*1000);

const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
        cb(null, file.originalname + "_" + generateFileID() + "_" + oneHourFromNow().getTime());
    }
})
const upload = multer({
    storage,
    limits: {fields: 0}
});

router.post("/fh",
    upload.array('file', 10),
    getHost,

    (err, req, res, next) => {
        if (err.code == 'LIMIT_UNEXPECTED_FILE') {
            res.status(400).send("The amount of uploaded files exceeds the limit of 10 files at a time.");
        } else {
            next(err);
        }
    },

    (req, res) => {
        let rateLimit = rateLimits.get(req.ip);
        if (rateLimit) {
            if (rateLimit.expires < new Date()) {
                rateLimit = null;
            }
        }

        const uploadSize = req.files.reduce((prev, curr) => prev + curr.size, 0);
        const usedBytes = rateLimit?.bytes ?? 0;

        if (uploadSize >= 10*1024*1024) {
            res.status(400).send(`The uploaded file(s) exceed the file size limit of 10 MB.`);
            req.files.forEach(f => fs.rm(f.path, () => {}));
            return;
        }

        if (usedBytes + uploadSize >= 50*1024*1024) {
            const remainingBytes = (50*1024*1024 - usedBytes).toLocaleString();
            const waitTime = Math.round((rateLimit.expires - new Date)/(60*1000));

            res.status(400).send(`You have reached the upload limit (50 MB per hour). Please upload a smaller file (up to ${remainingBytes} bytes) or wait ${waitTime} minutes.`);
            req.files.forEach(f => fs.rm(f.path, () => {}));
            return;
        }

        let hasJars = false;
        const expireAt = new Date();
        expireAt.setHours(new Date().getHours() + 1);
        
        const twoDigit = (n) => n.toString().length == 1 ? '0' + n : n;
        const expireHours = twoDigit(expireAt.getUTCHours());
        const expireMins = twoDigit(expireAt.getUTCMinutes());
        const expireSecs = twoDigit(expireAt.getUTCSeconds());

        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DP File Host</title>
</head>
<body>
    <code>
    ${
        req.files.map(f => {
            const nameParts = f.filename.split('_');
            let url = nameParts[nameParts.length - 2];
            if (f.originalname.toLowerCase().endsWith('.nth')) {
                url += ".nth";
            }
            else if (f.originalname.toLowerCase().endsWith('.thm')) {
                url += ".thm";
            }
            url = "/" + url;

            let result = `${f.originalname}: <a href="${url}">http://${res.locals.host}${url}</a>`;
            if (f.originalname.endsWith('.jar')) {
                result += `, jad: <a href="${url}.jad">http://${res.locals.host}${url}.jad</a>, signed: <a href="${url}.sjad">http://${res.locals.host}${url}.sjad</a>`;
                hasJars = true;
            }
            return result;
        })
        .join('<br/>')
    }
    ${
        hasJars ? `<br/><br/>Install the <i>signed</i> version for elevated app permissions if your device has the Darkman certificate installed. See guides for <a href="https://gtrxac.fi/j2me/proxyless#s40">Nokia S40</a> and <a href="https://gtrxac.fi/j2me/proxyless#se">Sony Ericsson</a>.<br/>The guides are intended for Discord J2ME but the methods also apply to other apps. Certificate installation is also possible on older Sony Ericsson devices.` : ""
    }
    <br/>
    <br/>
    ${req.files.length != 1 ? "Files expire" : "File expires"} at ${expireHours}:${expireMins}:${expireSecs} (UTC).
    </code>
</body>
</html>`)
        
        rateLimits.set(req.ip, {
            expires: oneHourFromNow(),
            bytes: usedBytes + uploadSize
        })
    }
)

function findFileFromID(req, res, next) {
    req.fileID = req.path.slice(1, 7);
    req.fileName = fs.readdirSync(uploadDir)
        .find(f => f.split('_')[f.split('_').length - 2] === req.fileID);

    if (!req.fileName) {
        res.status(404).send("File not found. The specified file ID is invalid or the file has expired.");
        return;
    }
    next();
}

function downloadFile(req, res, outName) {
    outName = "/tmp/" + outName;
    fs.cpSync(uploadDir + "/" + req.fileName, outName);

    // This fixes the content type header for Nokia S40 theme files, which is not auto-detected correctly by the sendFile function.
    // If the content type is not set correctly, the device downloads the file with a ".EXT" file extension and it is not detected as a supported file type.
    // Similar content type mappings may have to be done for other less common file types.
    if (outName.toLowerCase().endsWith('.nth')) {
        res.set("Content-Type", "application/vnd.nok-s40theme");
    }
    else if (outName.toLowerCase().endsWith('.thm')) {
        res.set("Content-Type", "application/vnd.eri.thm");
    }
    res.sendFile(outName, () => fs.rmSync(outName));
}

// File ID supplied: download file with its original uploaded file name
router.get("/[adgjmptw]{6}", findFileFromID, (req, res) => {
    const name = req.fileName.split('_').slice(0, -2).join('_');
    downloadFile(req, res, name);
});

function generateJad(sign) {
    return (req, res) => {
        // If the file is already a jad
        if (/\.jad_\w{6}_\d+$/.test(req.fileName)) {
            if (sign) {
                // Need to sign: we can't sign a jad without a jar
                res.status(400).send("Cannot generate a signed JAD without a JAR");
            } else {
                // No need to sign: send the jad directly
                downloadFile(req, res, req.path.slice(1));
            }
            return;
        }
        
        // File is not a jar (and not a jad), can't do anything with it
        if (!/\.jar_\w{6}_\d+$/.test(req.fileName)) {
            res.status(400).send("Not a JAR file");
            return;
        }

        const jadName = "/tmp/" + req.fileName.split('_').slice(0, -2).join('_').replace(/\.jar$/, '.jad');

        jadmaker2.createJadFromJar(
            uploadDir + "/" + req.fileName,
            jadName,
            `http://${res.locals.host}/${req.fileID}.jar`,
            `http://${res.locals.host}`,
            sign
        );

        res.sendFile(jadName, (err) => {
            if (!err) fs.rmSync(jadName);
        });
    }
}

// File ID and extension ".jad" supplied: generate and send JAD that corresponds to the JAR
router.get("/[adgjmptw]{6}.jad", getHost, findFileFromID, generateJad(false));

// File ID and extension ".sjad" supplied: generate, sign, and send JAD that corresponds to the JAR
router.get("/[adgjmptw]{6}.sjad", getHost, findFileFromID, generateJad(true));

// File ID and any other file extension supplied: download file with custom file name
router.get("/[adgjmptw]{6}\\.\\w+", findFileFromID, (req, res) => {
    downloadFile(req, res, req.path.slice(1));
});

// File ID and /d supplied: send a HTML page that has download links for the file (and for the JAD if it's a JAR)
// for e.g. NEC e616
router.get("/[adgjmptw]{6}/d", findFileFromID, (req, res) => {
    const isJar = /\.jar_\w{6}_\d+$/.test(req.fileName);

    const downloadLinks = isJar ?
        `<p><a href="/${req.fileID}.jar">Download JAR</a></p>
        <p><a href="/${req.fileID}.jad">Download JAD</a></p>` :

        `<p><a href="/${req.fileID}">Download file</a></p>`;

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Download ${req.fileID}</title>
</head>
<body>
    ${downloadLinks}
</body>
</html>`);
})

module.exports = router;