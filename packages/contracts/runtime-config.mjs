import {readFile} from 'node:fs/promises';
import {EXECUTION_TYPES} from './execution.mjs';
export const PROVIDER_SECRETS=Object.freeze(['DEEPSEEK_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY','ARK_API_KEY','PADDLEOCR_ACCESS_TOKEN','OPENAI_API_KEY','ELEVENLABS_API_KEY']);
export const DATABASE_SECRETS=Object.freeze(['SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ACCESS_TOKEN','DATABASE_URL','POSTGRES_URL']);
export function assertModuleEnvironment(module,env){const forbidden=module==='api'?PROVIDER_SECRETS:module==='agent'?DATABASE_SECRETS:[...PROVIDER_SECRETS,...DATABASE_SECRETS];if(forbidden.some(key=>env[key]))throw Error('Forbidden credential in '+module+' environment');}
export async function executorToken(env){const token=(await readFile(env.LEAFHOUR_AGENT_TOKEN_FILE,'utf8')).trim();if(token.length<24)throw Error('Executor identity must contain at least 24 characters');return token;}
export function configuredCapabilities(env){const capabilities=(env.LEAFHOUR_AGENT_CAPABILITIES||'').split(',').map(v=>v.trim()).filter(Boolean);if(capabilities.some(type=>!EXECUTION_TYPES.includes(type)))throw Error('Unknown Agent capability configured');return [...new Set(capabilities)];}
export async function runtimeVersion(module,env=process.env){let sourceCommit=env.LEAFHOUR_SOURCE_COMMIT||null;try{sourceCommit=JSON.parse(await readFile(new URL('../../manifest.json',import.meta.url),'utf8')).sourceCommit||sourceCommit;}catch(error){if(error.code!=='ENOENT')throw error;}return {module,sourceCommit,protocol:1};}
