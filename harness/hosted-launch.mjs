import path from 'node:path';
import {fileURLToPath} from 'node:url';

// The SDK owns this PID and its pipes. Replace it instead of introducing a
// forwarding process that could outlive cancellation or lose stdin EOF.
if(process.platform!=='linux'||process.arch!=='x64')throw Error('The hosted reader launcher requires linux x64.');
if(typeof process.execve!=='function')throw Error('The hosted reader launcher requires process.execve.');
const directory=path.dirname(fileURLToPath(import.meta.url));
const executable=path.join(directory,'node');
const cli=path.join(directory,'../node_modules/@deepseek-ai/dsh/lib/bin.js');
process.execve(executable,[executable,cli,...process.argv.slice(2)],process.env);
