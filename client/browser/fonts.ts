import okxRegular from '../../public/fonts/okxr.woff2'
import okxMedium from '../../public/fonts/okxm.woff2'
import bmrRegular from '../../public/fonts/bmr.woff2'

/** Register on the document: font faces declared inside a shadow stylesheet are not shared. */
export function registerBuilderFonts(document: Document): void {
  for (const [family, weight, source] of [
    ['OKX', '400', okxRegular],
    ['OKX', '500', okxMedium],
    ['BMR', '400', bmrRegular]
  ] as const) {
    if ([...document.fonts].some(face => face.family === family && face.weight === weight && face.style === 'normal')) continue
    document.fonts.add(new FontFace(family, `url("${source}")`, { weight, style: 'normal', display: 'swap' }))
  }
}
