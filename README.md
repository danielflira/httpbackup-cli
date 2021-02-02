# httpbackup-cli

Enviando arquivos:

```
$ node src/main.js --server http://localhost:3000 --path ${PWD}
```

Enviando vários diretórios:

```
$ node src/main.js --server http://localhost:3000 --path ${PWD} --path ${HOME}
```

Enviando arquivos e ignorando com regex:

```
$ node src/main.js --server http://localhost:3000 --path ${PWD} --ignore '.git/'
```

Enviando arquivos modificados nos últimos 60 segundos:

```
$ node src/main.js --server http://localhost:3000 --path ${PWD}  --modified 60
```

Simulando listagem sem o envio real dos arquivos

```
$ node src/main.js --server http://localhost:3000 --path ${PWD}  --modified 60 --dry-run
```

## Gerando binário

```
$ ./node_modules/.bin/nexe --target windows-x64 src/main.js
# ou 
$ npm run bin-win
```
