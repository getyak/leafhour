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

