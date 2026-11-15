export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Products without `img` keep the exact placeholder used before photos existed.
export function productFigure(p, dim) {
  if (!p.img) {
    return '<figure class="media ar-11"><div class="media__in"><img src="assets/img/blank-11.svg" alt="" loading="lazy" draggable="false"></div></figure>';
  }
  const width = Number(dim && dim.width);
  const height = Number(dim && dim.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`Dimensions invalides pour ${p.id || 'cet article'}`);
  }
  return `<figure class="media ar-11"><div class="media__in"><img src="${esc(p.img)}" alt="${esc(p.name)}" width="${width}" height="${height}" loading="lazy"></div></figure>`;
}
