import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/app.js'],bundle:true,format:'esm',outdir:'dist',minify:true,legalComments:'eof',loader:{'.png':'dataurl','.svg':'dataurl'}});
await copyFile('src/index.html','dist/index.html');
