export function createPaperCompanion(doc,{pose='loading'}={}){
  const node=(tag,className)=>{const element=doc.createElement(tag);element.className=className;return element;};
  const scene=node('div','arrival-scene paper-companion paper-companion-'+pose);scene.setAttribute('aria-hidden','true');
  const floor=node('i','arrival-floor'),person=node('div','arrival-person'),face=node('div','arrival-face');
  for(const part of ['fold','eye eye-left','eye eye-right','smile','cheek cheek-left','cheek cheek-right'])face.append(node('i','arrival-'+part.replaceAll(' ',' arrival-')));
  person.append(face,node('i','arrival-shirt'),node('i','arrival-arm arrival-arm-left'),node('i','arrival-arm arrival-arm-right'),node('i','arrival-leg arrival-leg-left'),node('i','arrival-leg arrival-leg-right'));
  const book=node('div','arrival-book');for(const part of pose==='bookmark'?['left','right']:['left','right','turn'])book.append(node('i','arrival-page arrival-page-'+part));person.append(book);
  if(pose==='bookmark')book.append(node('i','arrival-bookmark'));
  scene.append(floor,person);if(pose!=='bookmark')scene.append(node('i','arrival-leaf arrival-leaf-one'),node('i','arrival-leaf arrival-leaf-two'));
  return scene;
}

// Render the same decorative drawing on the server, before modules or auth.
export function paperCompanionHtml(){
 const doc={createElement:tag=>({tag,className:'',attrs:{},children:[],setAttribute(name,value){this.attrs[name]=value;},append(...nodes){this.children.push(...nodes);}})};
 const html=node=>'<'+node.tag+' class="'+node.className+'"'+Object.entries(node.attrs).map(([name,value])=>' '+name+'="'+value+'"').join('')+'>'+node.children.map(html).join('')+'</'+node.tag+'>';
 return html(createPaperCompanion(doc));
}
