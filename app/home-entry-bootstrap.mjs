import {enterAutoHome} from './home-entry.mjs';

// Start the small root decision before the larger portal graph settles.
// Both the head script and portal import share this exact module promise.
export const homeEntryReady=typeof window==='undefined'
 ?Promise.resolve({kind:'continue',reason:'no-browser'})
 :enterAutoHome();
