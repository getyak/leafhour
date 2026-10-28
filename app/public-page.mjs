import {mountHomeNavigation} from './home-navigation.mjs';
import './site-appearance.mjs';

// Support pages need the shared public menu, without the private library or
// billing controllers. Search keeps its existing on-demand palette bootstrap.
if(globalThis.document){
 const menu=mountHomeNavigation();
 document.querySelector('#home-menu [data-close]')?.addEventListener('click',()=>menu?.close('user'));
}
