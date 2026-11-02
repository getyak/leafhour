import {fail} from './document-import.mjs';
import {inferSourceLanguage} from '../app/source-language.mjs';
export const translationLanguages=Object.freeze({zh:'中文',en:'英文',ja:'日文',ko:'韩文',fr:'法文',de:'德文',es:'西班牙文'});
export function validateTranslationLanguage(value){if(typeof value!=='string'||!Object.hasOwn(translationLanguages,value))throw fail('翻译语言不正确');return value;}
export function translationDirection(passage,options={}){const sourceLanguage=validateTranslationLanguage(options.sourceLanguage??inferSourceLanguage(passage.original)),targetLanguage=validateTranslationLanguage(options.targetLanguage??'zh');if(sourceLanguage===targetLanguage)throw fail('原文语言与译入语言相同，无需翻译');return {sourceLanguage,targetLanguage};}
// Chinese remains the original wire/storage projection. Additional targets
// live beside it so older clients and full-book exports keep their contract.
export function translationPair(passage,targetLanguage='zh'){return targetLanguage==='zh'?passage?.translations||{}:passage?.translationsByLanguage?.[targetLanguage]||{};}
export function projectTranslation(passage,targetLanguage='zh'){return {...passage,translations:translationPair(passage,targetLanguage)};}
export function translationPayload(passage){return {translations:passage.translations||{},...(Object.keys(passage.translationsByLanguage||{}).length?{translationsByLanguage:passage.translationsByLanguage}:{})};}
export function hasTranslations(passage){return Object.keys(passage.translations||{}).length||Object.keys(passage.translationsByLanguage||{}).length;}
export function mergeLanguageMaps(...maps){const result={};for(const map of maps)for(const [language,pair]of Object.entries(map||{}))result[language]={...result[language],...pair};return result;}
