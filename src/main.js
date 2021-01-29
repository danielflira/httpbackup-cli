const fs = require("fs");
const path = require("path");
const stream = require("stream");
const {promisify} = require("util");
const Crypto = require("crypto");

const got = require("got");
const {program} = require("commander");

async function walk(filePath = "./") {
    let entries = await fs.promises.readdir(filePath, {withFileTypes: true});
    let files = [];

    for (let i = 0; i < entries.length; i++) {
        const fullFilePath = path.join(filePath, entries[i].name);

        if (entries[i].isDirectory())
            files.push(...await walk(fullFilePath));

        else
            files.push(fullFilePath);
            
    }

    return files
}

async function checkFileHash(file) {
    let fileStream = fs.createReadStream(file);
    let sha512Temp = Crypto.createHash("sha512");

    fileStream.pipe(sha512Temp);

    return new Promise((accept, reject) => {
        fileStream.on("end", () => {
            let sha512 = sha512Temp.read().toString("hex");
            fileStream.close();
            accept(sha512);
        });

        fileStream.on("error", (e) => {
            console.log(e);
            reject(e);
        });
    });

}

async function sendToServer(serverURL, entity, file) {
    console.log(`sending ${file}`)

    const pipeline = promisify(stream.pipeline);

    serverURL =  entity && `${serverURL}/store/${entity}` || `${serverURL}/store`;

    try {
        await pipeline(
            fs.createReadStream(file),
            got.stream.post(`${serverURL}/${file}`));
        return true;
    } catch(e) {
        return false;
    }
}

async function sendToServerWithRetry(serverURL, entity, file, retries) {
    for ( let i = retries; i > 0; i--) {
        if ( (await sendToServer(serverURL, entity, file)) ) break;
    }
}


async function main(params) {
    let {path, server, entity, ignore, dryRun, modified, retries} = params;

    if ( ignore === undefined ) {
        ignore = [];
    }

    let ignoreRE = []
    for ( let i = 0; i < ignore.length; i++ ) {
        ignoreRE.push(RegExp(ignore[i]));
    }

    for ( let i = 0; i < path.length; i++ ) {
        console.log(`backuping ${path[i]} to ${server} ${entity ? "on entity " + entity : ""}`)

        let files = (await walk(path[i])).filter(file => {
            for ( let j = 0; j < ignoreRE.length; j++) {
                if ( ignoreRE[j].test(file) ) {
                    return false;
                }
            }
            return true;
        });

        if ( modified ) {
            modified = new Date() - (modified * 1000);
        } else {
            modified = 0;
        }

        let newer = [];
        for ( let i = 0; i < files.length; i++ ) {
            let stat = await fs.promises.stat(files[i]);

            if ( stat.mtime.getTime() > modified ) {
                newer.push(files[i]);
            }
        }

        files = newer;
        for ( let j = 0; j < files.length; j++) {
            let sha512 = null;
            let response = null;

            try {
                sha512 = await checkFileHash(files[j]);
            } catch(e) {
                console.log(`[ERROR] to calc hash ${files[j]}`);
                continue;
            }

            try {
                response = await got(`${server}/hash/${sha512}`).json();
            } catch(e) {
                console.log(`[ERROR] to check hash on server ${files[j]}`);
                continue;
            }

            if (response.exists) {
                console.log(`ignoring ${files[j]} (already exists)`);
                continue;
            }

            console.log(`preparing ${files[j]}`)
            !dryRun && await sendToServerWithRetry(server, entity, files[j], retries);
        }
    }
}

program
    .version("0.0.1")
    .option("-e, --entity <entity>", "Inform backup entity namespace", "")
    .option("-i, --ignore <regularExpression...>", "Inform regular expression to ignore files")
    .option("--dry-run", "Does not send any file, just list selected", false)
    .option("--modified <seconds>", "modified seconds early")
    .option("--retries <count>", "set how many times try to send file", 3)
    .requiredOption("-s, --server <server>", "Inform HTTP backup server")
    .requiredOption("-p, --path <pathToBackup...>", "Inform path to backup")
    .parse(process.argv);

main(program);