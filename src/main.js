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

function pathNormalize(path) {
    return path.replace(/\\/g, "/");
}

async function sendToServer(serverURL, entity, file) {
    const pipeline = promisify(stream.pipeline);
    let newFile = escape(pathNormalize(file));

    serverURL =  entity && `${serverURL}/store/${entity}` || `${serverURL}/store`;

    console.log(`sending ${file}`);
    try {
        await pipeline(
            fs.createReadStream(file),
            got.stream.post(`${serverURL}/${newFile}`));
        console.log(`succeed to send ${file}`)
        return true;
    } catch(e) {
        console.log(`failed to send ${file}`);
        console.log(e);
        return false;
    }
}

async function sendToServerWithRetry(serverURL, entity, file, retries) {
    for ( let i = retries; i > 0; i--) {
        if ( (await sendToServer(serverURL, entity, file)) ) break;
    }
}

function printResume(resume) {
    let elapseTime = (Date.now() - resume.startBackup.getTime()) / 1000;
    let avgTime =  elapseTime / resume.processed;

    console.log(
        "\n+----------\n",
        `\r| processados: ${resume.processed}/${resume.remainingFiles}\n`,
        `\r| tempo decorrido: ${elapseTime} segundos \n`,
        `\r| tempo médio: ${avgTime} segundos\n`,
        `\r| tempo estimado: ${(resume.remainingFiles - resume.processed) * avgTime} segundos\n`,
        "\r+----------\n"
    );
}

async function main(params) {
    let {path, server, entity, ignore, dryRun, modified, retries, hideModified, check} = params;
    let resume = {};
    let files = [];

    resume.startProcess = new Date();
    resume.startScan = new Date();

    for ( let i = 0; i < path.length; i++ ) {
        console.log(`scanning path ${path[i]}`);

        let newFiles = await walk(path[i]);
        files = files.concat(newFiles);
    }

    resume.totalFiles = files.length;
    resume.endScan = new Date();
    console.log(`scanned resume ${resume.totalFiles} files in ${(resume.endScan.getTime() - resume.startScan.getTime()) / 1000} seconds`);
    
    resume.startIgnore = new Date();
    resume.remainingFiles = files.length;

    if ( ignore === undefined ) {
        ignore = [];
    }

    let ignoreRE = []
    for ( let i = 0; i < ignore.length; i++ ) {
        ignoreRE.push(RegExp(ignore[i]));
    }

    for ( let i = 0; i < ignoreRE.length; i++) {
        console.log(`checking regex ${ignoreRE[i]}`);

        files = files.filter(file => {
            if ( ignoreRE[i].test(file) ) {
                console.log(`ignored by regex ${ignoreRE[i]} - ${file}`)
                return false;
            }
            return true;
        });
    }

    resume.totalIgnore = resume.remainingFiles - files.length;
    resume.endIgnore = new Date();
    console.log(`ignored resume by regex ${resume.totalIgnore} in ${(resume.endIgnore.getTime() - resume.startIgnore.getTime()) / 1000} seconds`);

    resume.startModified = new Date();
    resume.remainingFiles = files.length;

    if ( modified ) {
        let baseTime = Date.now() - (modified * 60000);
        let newFiles = [];

        let dateToPrint = new Date();
        dateToPrint.setTime(baseTime);

        console.log(`checking modified files since ${dateToPrint}`);

        for ( let i = 0; i < files.length; i++ ) {
            try {
                let stat = await fs.promises.stat(files[i]);

                if ( stat.mtime.getTime() < baseTime ) {
                    if ( !hideModified ) console.log(`ignored by modified ${files[i]}`);
                    continue
                }

                newFiles.push(files[i]);
            } catch(e) {
                console.log(`failed to get stat ${files[i]}`);
                console.log(e);

                // if it can't check stat try to backup anyway
                newFiles.push(files[i]);

                continue
            }
        }

        files = newFiles;
    }

    resume.totalNotModified = resume.remainingFiles - files.length;
    resume.endModified = new Date();
    console.log(`ignored resume by modify ${resume.totalNotModified} in ${(resume.endModified.getTime() - resume.startModified.getTime()) / 1000} seconds`);

    resume.startBackup = new Date();
    resume.remainingFiles = files.length;
    resume.timeSpentHashing = 0;
    resume.countHash = 0;
    resume.timeSpentSending = 0;
    resume.countSend = 0;
    resume.lastFileTime = Date.now();
    resume.timeSpent = 0;
    resume.processed = 0;

    console.log(`backuping ${files.length} files`);
    for ( let i = 0; i < files.length; i++) {
        let sha512 = null;
        let response = null;

        resume.processed = i+1;

        if ( Date.now() - resume.lastFileTime > 60000 ) {
            resume.lastFileTime = Date.now();
            printResume(resume);
        }

        if ( check ) {
            let startHashing = new Date();
            
            try {
                console.log(`calculating hash ${files[i]}`);
                sha512 = await checkFileHash(files[i]);
            } catch(e) {
                console.log(`failed to calc hash ${files[i]}`);
                console.log(e);
                continue;
            }

            let endHashing = new Date();
            resume.timeSpentHashing += (endHashing.getTime() - startHashing.getTime());
            resume.countHash += 1;
            resume.avgHashingTime = resume.timeSpentHashing / resume.countHash;

            try {
                response = await got(`${server}/hash/${sha512}`).json();

                if (response.exists) {
                    console.log(`ignored by hash ${files[i]} (already exists)`);
                    continue;
                }
            } catch(e) {
                console.log(`failed to check hash on server ${files[i]}`);
                console.log(e);
                continue;
            }
        }

        let startSending = new Date();

        !dryRun && await sendToServerWithRetry(server, entity, files[i], retries);

        let endSending = new Date();
        resume.timeSpentSending += (endSending.getTime() - startSending.getTime());
        resume.countSend += 1;
        resume.avgSendingTime = resume.timeSpentSending / resume.countSend;
    }

    printResume(resume);
}

program
    .version("0.0.1")
    .option("-e, --entity <entity>", "Inform backup entity namespace", "")
    .option("-i, --ignore <regularExpression...>", "Inform regular expression to ignore files")
    .option("--dry-run", "Do not send any file, just list selected", false)
    .option("--hide-modified", "Hide message of not modified files", false)
    .option("--no-check", "Do not check hash on server", false)
    .option("--modified <seconds>", "modified minutes early")
    .option("--retries <count>", "set how many times try to send file", 3)
    .requiredOption("-s, --server <server>", "Inform HTTP backup server")
    .requiredOption("-p, --path <pathToBackup...>", "Inform path to backup")
    .parse(process.argv);

main(program);