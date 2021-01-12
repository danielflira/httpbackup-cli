const fs = require("fs");
const path = require("path");
const stream = require("stream");
const {promisify} = require("util");

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

async function sendToServer(serverURL, entity, file) {
    const pipeline = promisify(stream.pipeline);

    serverURL =  entity && `${serverURL}/store/${entity}` || `${serverURL}/store`;

    await pipeline(
        fs.createReadStream(file),
        got.stream.post(`${serverURL}/${file}`));
}


async function main(params) {
    let {path, server, entity, ignore, dryRun, modified} = params;

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
            console.log(`sending ${files[j]}`)
            !dryRun && await sendToServer(server, entity, files[j]);
        }
    }
}

program
    .version("0.0.1")
    .option("-e, --entity <entity>", "Inform backup entity namespace", "")
    .option("-i, --ignore <regularExpression...>", "Inform regular expression to ignore files")
    .option("--dry-run", "Does not send any file, just list selected", false)
    .option("--modified <seconds>", "modified seconds early")
    .requiredOption("-s, --server <server>", "Inform HTTP backup server")
    .requiredOption("-p, --path <pathToBackup...>", "Inform path to backup")
    .parse(process.argv);

main(program);