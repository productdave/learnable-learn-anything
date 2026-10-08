import { escapeHome as esc } from './home-model.js?v=7';

export function sharedImageHTML(section,locator,{review=false}={}) {
  return `<figure class="topic-image shared-course-image" data-shared-image="${esc(locator)}"><img alt="${esc(section.alt)}" hidden><p data-shared-description>${esc(section.alt)}</p><p role="status" aria-live="polite">Loading image…</p><button type="button" class="home-button home-button--secondary" hidden>Retry image</button><figcaption>${section.caption?`${esc(section.caption)} · `:''}AI-generated illustration</figcaption>${review?`<p class="shared-image-alt"><strong>Alternative text:</strong> ${esc(section.alt)}</p>`:''}</figure>`;
}
export async function fetchSharedImage(path) {
  if(!/^\/api\/courses\/public-image\?courseId=public-[a-f0-9-]{36}&imageId=[a-f0-9]{64}$/.test(path))throw new Error('This shared image is not available.');
  const response=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(response.status===404?'This image is no longer shared. Reopen the course to check its availability.':'The shared image could not be loaded. Retry loading; no new image will be generated.');
  return response.blob();
}
export function mountSharedImages(container,{loadImage=fetchSharedImage,isCurrent=()=>true}={}) {
  let disposed=false;const urls=new Set(),figures=[...container.querySelectorAll('[data-shared-image]')];
  const valid=figure=>!disposed&&isCurrent()&&figure.isConnected;
  const load=async figure=>{
    const img=figure.querySelector('img'),status=figure.querySelector('[role="status"]'),button=figure.querySelector('button'),description=figure.querySelector('[data-shared-description]');
    button.disabled=true;status.textContent='Loading image…';
    const failure=message=>{if(!valid(figure))return;img.hidden=true;description.hidden=false;status.textContent=message;button.hidden=false;button.disabled=false;};
    try {
      const blob=await loadImage(figure.dataset.sharedImage);
      if(!valid(figure))return;
      if(blob.type!=='image/png'||blob.size>8388608)throw new Error('This image could not be verified. Retry loading; no image is regenerated.');
      const old=img.getAttribute('src');if(urls.has(old)){URL.revokeObjectURL(old);urls.delete(old);}
      const url=URL.createObjectURL(blob);urls.add(url);
      img.onload=()=>{if(valid(figure)){img.hidden=false;description.hidden=true;status.textContent='';button.hidden=true;}};
      img.onerror=()=>failure('The image could not be displayed. Retry loading; no new image will be generated.');
      img.src=url;
    } catch(error){failure(error.message);}
  };
  for(const figure of figures){figure.querySelector('button').onclick=()=>load(figure);load(figure);}
  return ()=>{disposed=true;for(const url of urls)URL.revokeObjectURL(url);urls.clear();for(const figure of figures){figure.querySelector('img')?.removeAttribute('src');figure.querySelector('img').hidden=true;}};
}
let disposeCurrent=()=>{};
export function disposeSharedCourseImages(){disposeCurrent();disposeCurrent=()=>{};}
export function mountSharedCourseImages(container){disposeSharedCourseImages();disposeCurrent=mountSharedImages(container);}
