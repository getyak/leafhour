export const isReadingDivider=text=>typeof text==='string'&&/^\s*(?:(?:\*\s*){3,}|(?:·\s*){3,})$/.test(text);

export function createChapterFlow({chapters,render}) {
  const nodes=new Map();let rendered=[];
  const nextId=()=>chapters[chapters.findIndex(c=>c.id===rendered.at(-1))+1]?.id||null;
  const prepare=id=>{if(!id)return null;if(!nodes.has(id)){const chapter=chapters.find(c=>c.id===id);if(!chapter)return null;nodes.set(id,render(chapter));}return nodes.get(id);};
  return {
    get nextId(){return nextId();},
    get renderedIds(){return [...rendered];},
    node:id=>nodes.get(id)||null,
    start(id){nodes.clear();rendered=[id];return prepare(id);},
    prepareNext:()=>prepare(nextId()),
    appendNext(){const id=nextId();if(!id)return null;const node=prepare(id);rendered.push(id);return {id,node};},
    invalidatePrepared(){for(const id of nodes.keys())if(!rendered.includes(id))nodes.delete(id);}
  };
}
