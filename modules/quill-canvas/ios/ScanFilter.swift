// Makes a scanned page look like a clean original, on the iPad. Nothing is retyped or
// guessed: every letter stays exactly where and how it was written; only the picture
// gets better. Works on the ink separately from the paper:
//   1. Size it: small scans are enlarged so there's room for smooth edges.
//   2. Find the paper's lighting and remove it (shadows and grey paper become even white).
//   3. Make a clean mask of the ink: grain is gone, and rough pixel edges become smooth curves.
//   4. Redraw: the ink's own colour, through that mask, on the paper (highlighter kept).
//   5. Pictures and solid dark areas aren't ink: those keep their real detail.
// Only the ink's edges are worked on at full size. Everything wide (lighting, paper,
// speckle checks, finding pictures) is worked out on a small copy: it looks the same and
// takes a fraction of the memory.
import CoreImage

enum ScanFilter {
  /// Settings for comparing versions side by side (scripts/scan-check.swift). The app uses the defaults.
  nonisolated(unsafe) static var tune: [String: CGFloat] = [:]
  private static func t(_ key: String, _ value: CGFloat) -> CGFloat { tune[key] ?? value }

  /// The cleaned page, or nil if it couldn't be made even at the smaller size.
  static func render(_ input: CIImage, mode: String, context: CIContext) -> CGImage? {
    for target: CGFloat in [3200, 2400] {
      let out = clean(input, mode: mode, target: target)
      if let cg = context.createCGImage(out, from: out.extent) { return cg }
      context.clearCaches()
    }
    return nil
  }

  /// `mode` "color" keeps pen and highlighter colours; "document" is crisp black on white.
  static func clean(_ input: CIImage, mode: String, target: CGFloat = 3200) -> CIImage {
    var image = input
    // 1. The working size. `soft` says how much the page was enlarged: the more it was, the
    //    softer its edges are, and the more smoothing they can take. A sharp, full-size
    //    scan gets very little, so small print stays open and readable.
    let scale = min(3, target / max(image.extent.width, image.extent.height))
    let soft = max(1, scale)
    if abs(scale - 1) > 0.01 {
      image = image.applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: scale, kCIInputAspectRatioKey: 1.0])
    }
    // Everything below is judged the way the eye sees it, not in raw light values.
    image = image.settingAlphaOne(in: image.extent).applyingFilter("CILinearToSRGBToneCurve")
    let ext = image.extent
    let px = max(ext.width, ext.height) / 3600

    func blur(_ i: CIImage, _ r: CGFloat) -> CIImage {
      i.clampedToExtent().applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: r]).cropped(to: i.extent)
    }
    func curve(_ i: CIImage, _ p: [(CGFloat, CGFloat)]) -> CIImage {
      i.applyingFilter("CIToneCurve", parameters: [
        "inputPoint0": CIVector(x: p[0].0, y: p[0].1), "inputPoint1": CIVector(x: p[1].0, y: p[1].1), "inputPoint2": CIVector(x: p[2].0, y: p[2].1),
        "inputPoint3": CIVector(x: p[3].0, y: p[3].1), "inputPoint4": CIVector(x: p[4].0, y: p[4].1),
      ]).cropped(to: i.extent)
    }
    func shrink(_ i: CIImage, _ q: CGFloat) -> CIImage {
      i.applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: q, kCIInputAspectRatioKey: 1.0])
    }
    func grow(_ i: CIImage, _ q: CGFloat) -> CIImage {
      i.clampedToExtent().transformed(by: CGAffineTransform(scaleX: 1 / q, y: 1 / q)).cropped(to: ext)
    }
    func maximum(_ i: CIImage, _ r: CGFloat) -> CIImage {
      i.clampedToExtent().applyingFilter("CIMorphologyMaximum", parameters: ["inputRadius": max(1, r)]).cropped(to: i.extent)
    }
    func colourless(_ i: CIImage) -> CIImage { i.applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 0.0]) }

    // Grain off first, or it would be read as ink.
    let calm = blur(image.applyingFilter("CINoiseReduction", parameters: ["inputNoiseLevel": 0.03, "inputSharpness": t("sharp", 0.6)]).cropped(to: ext), t("blur", 0.6) * soft)

    // 2. The paper's lighting: at 1/16 size writing nearly vanishes; keep the brightest
    //    nearby value, soften it, and divide the page by it. Colourless, so a highlighter
    //    can't tint the writing beside it.
    let k: CGFloat = 1 / 16
    let litSmall = maximum(colourless(shrink(calm, k)), 4)
    let lit = blur(litSmall, 5).applyingFilter("CIColorClamp", parameters: [
      "inputMinComponents": CIVector(x: 0.1, y: 0.1, z: 0.1, w: 1), "inputMaxComponents": CIVector(x: 1, y: 1, z: 1, w: 1),
    ])
    let flat = grow(lit, k).applyingFilter("CIDivideBlendMode", parameters: [kCIInputBackgroundImageKey: calm]).cropped(to: ext)

    // 3. The ink: how much darker it is than the paper right around it. A wide highlighter
    //    band isn't darker than its surroundings, so it's never mistaken for ink; text on it
    //    still is. A small blur then a steep curve turns jagged edges into smooth ones and
    //    closes little gaps in a broken line. The low end keeps faint pencil.
    let q: CGFloat = 1 / 4
    let lum = colourless(flat)
    let lumSmall = shrink(lum, q)
    let around = grow(blur(maximum(lumSmall, 14 * px * q), 4 * px * q), q)
    let grey = around.applyingFilter("CIDivideBlendMode", parameters: [kCIInputBackgroundImageKey: lum]).cropped(to: ext)
    // Each stroke is cut about two thirds of the way from its own darkest point to the paper. One fixed cut
    // can't work: where it catches pencil, it makes print fat enough to fill in its letters.
    let h: CGFloat = 1 / 2
    let greyHalf = shrink(grey, h)
    let core = greyHalf.clampedToExtent().applyingFilter("CIMorphologyMinimum", parameters: ["inputRadius": max(1, 3 * px * h)]).cropped(to: greyHalf.extent)
    let deepest = grow(blur(core, 2 * px * h), h).applyingFilter("CIColorClamp", parameters: [
      "inputMinComponents": CIVector(x: 0, y: 0, z: 0, w: 1), "inputMaxComponents": CIVector(x: 0.85, y: 0.85, z: 0.85, w: 1),
    ])
    let rise = deepest.applyingFilter("CISubtractBlendMode", parameters: [kCIInputBackgroundImageKey: blur(grey, 0.4 * soft)]).cropped(to: ext)
    let span = deepest.applyingFilter("CIColorInvert")
    let level = span.applyingFilter("CIDivideBlendMode", parameters: [kCIInputBackgroundImageKey: rise]).cropped(to: ext)
    let c = t("cut", 0)
    let faint = curve(level, [(0, 1), (0.56 + c, 1), (0.68 + c, 0.55), (0.8 + c, 0), (1, 0)])

    // Sensitive enough for pencil means grain gets through too, so faint marks only count
    // beside something definite: a real stroke, or a long ruled line. Specks are neither.
    let greySmall = shrink(grey, q)
    let sure = maximum(curve(greySmall, [(0, 1), (0.84, 1), (0.89, 0.6), (0.93, 0), (1, 0)]), 11 * px * q)
    func ruled(_ angle: CGFloat) -> CIImage {
      curve(greySmall.clampedToExtent().applyingFilter("CIMotionBlur", parameters: [kCIInputRadiusKey: 50 * px * q, kCIInputAngleKey: angle]).cropped(to: greySmall.extent),
            [(0, 1), (0.955, 1), (0.975, 0.4), (0.99, 0), (1, 0)])
    }
    let near = sure.applyingFilter("CIMaximumCompositing", parameters: [kCIInputBackgroundImageKey: ruled(0)])
      .applyingFilter("CIMaximumCompositing", parameters: [kCIInputBackgroundImageKey: ruled(.pi / 2)]).cropped(to: greySmall.extent)
    let allowed = grow(blur(near, 3 * px * q), q)
    var ink = faint.applyingFilter("CIMultiplyCompositing", parameters: [kCIInputBackgroundImageKey: allowed]).cropped(to: ext)

    // Printed ruling (a notebook's pale lines and margin) isn't part of what was written: a long,
    // straight, pale line goes. Dark lines (tables, underlines, boxes) and anything written stay.
    if t("rules", 1) > 0.5 {
      let r: CGFloat = 1 / 2
      let g2 = shrink(grey, r)
      let span = max(15, (64 * px * r).rounded())
      func odd(_ v: CGFloat) -> CGFloat { let n = max(3, v.rounded()); return n.truncatingRemainder(dividingBy: 2) == 0 ? n + 1 : n }
      func lines(_ w: CGFloat, _ hgt: CGFloat) -> CIImage {
        // Lightest value along a long run: only stays dark where the whole run is a line.
        let run = g2.clampedToExtent().applyingFilter("CIMorphologyRectangleMaximum", parameters: ["inputWidth": odd(w), "inputHeight": odd(hgt)]).cropped(to: g2.extent)
        let found = curve(run, [(0, 1), (t("lineDark", 0.9), 1), (t("lineDark", 0.9) + 0.04, 0.4), (0.985, 0), (1, 0)])
        // Back out to the whole line, a little thicker than it is.
        return found.clampedToExtent().applyingFilter("CIMorphologyRectangleMaximum", parameters: ["inputWidth": odd(w), "inputHeight": odd(3 * px * r + 2)]).cropped(to: g2.extent)
      }
      let across = lines(span, 1)
      let down = lines(1, span).applyingFilter("CIMorphologyRectangleMaximum", parameters: ["inputWidth": odd(3 * px * r + 2), "inputHeight": 3]).cropped(to: g2.extent)
      let rule = grow(across.applyingFilter("CIMaximumCompositing", parameters: [kCIInputBackgroundImageKey: down]).cropped(to: g2.extent), r)
      // Only where it's pale: pen and print crossing a line keep every pixel.
      let pale = curve(grey, [(0, 0), (t("pale", 0.72), 0), (t("pale", 0.72) + 0.08, 1), (0.99, 1), (1, 1)])
      let gone = rule.applyingFilter("CIMultiplyCompositing", parameters: [kCIInputBackgroundImageKey: pale]).cropped(to: ext)
      ink = ink.applyingFilter("CIMultiplyCompositing", parameters: [kCIInputBackgroundImageKey: gone.applyingFilter("CIColorInvert")]).cropped(to: ext)
    }

    // 5. Where nearly everything nearby is dark, it's a picture or a filled shape. A page
    //    of text never gets close to this.
    let p: CGFloat = 1 / 8
    let dark = curve(shrink(lum, p), [(0, 1), (0.6, 1), (0.8, 0.8), (0.9, 0.2), (0.96, 0)])
    let picture = grow(curve(blur(dark, 110 * px * p), [(0, 0), (0.3, 0), (0.4, 0.5), (0.48, 0.92), (0.55, 1)]), p)

    var out: CIImage
    if mode == "document" {
      let white = CIImage(color: .white).cropped(to: ext)
      let black = CIImage(color: CIColor(red: 0.05, green: 0.05, blue: 0.06)).cropped(to: ext)
      out = black.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: white, kCIInputMaskImageKey: ink]).cropped(to: ext)
      let photo = curve(lum, [(0, 0), (0.25, 0.2), (0.5, 0.5), (0.8, 0.86), (1, 1)])
      out = photo.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: out, kCIInputMaskImageKey: picture]).cropped(to: ext)
    } else {
      // 4. Paper: nearly white becomes pure white; a highlighter's colour stays. Ink is removed
      //    from it first by keeping the brightest nearby colour.
      let sheetSmall = blur(maximum(shrink(flat, q), 7 * px * q), 14 * px * q)
      let sheet = grow(curve(sheetSmall, [(0, 0), (0.4, 0.46), (0.7, 0.88), (0.82, 1), (1, 1)]), q)
      // The ink's colour, read from inside the strokes (their edges are paler), deepened.
      let half: CGFloat = 1 / 2
      let penSmall = shrink(flat, half).clampedToExtent().applyingFilter("CIMorphologyMinimum", parameters: ["inputRadius": max(1, 2.5 * px * half)]).cropped(to: shrink(flat, half).extent)
      let pen = grow(blur(penSmall, 2.5 * px * half), half)
      let deep = curve(pen.applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 1.5]), [(0, 0), (0.2, 0.03), (0.45, 0.16), (0.7, 0.42), (1, 0.95)])
      var colour = deep
      if t("neutral", 1) > 0.5 {
        let grey0 = colourless(pen)
        let chroma = colourless(pen.applyingFilter("CIDifferenceBlendMode", parameters: [kCIInputBackgroundImageKey: grey0]).cropped(to: ext))
        let tinted = curve(chroma.applyingFilter("CIColorControls", parameters: [kCIInputContrastKey: 1.0, kCIInputBrightnessKey: 0.0]), [(0, 0), (0.035, 0), (0.07, 0.5), (0.11, 1), (1, 1)])
        let plain = curve(grey0, [(0, 0.05), (0.25, 0.08), (0.5, 0.25), (0.75, 0.55), (1, 0.9)])
        colour = deep.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: plain, kCIInputMaskImageKey: tinted]).cropped(to: ext)
      }
      out = colour.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: sheet, kCIInputMaskImageKey: ink]).cropped(to: ext)
      // Pictures keep their own detail, with the lighting fixed.
      let photo = curve(flat, [(0, 0), (0.25, 0.2), (0.5, 0.5), (0.8, 0.86), (1, 1)])
      out = photo.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: out, kCIInputMaskImageKey: picture]).cropped(to: ext)
    }
    return out.applyingFilter("CISRGBToneCurveToLinear").cropped(to: ext)
  }
}
