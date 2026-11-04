// Makes a scanned page look like a clean original, on the iPad. Nothing is retyped or
// guessed: every letter stays exactly where and how it was written; only the picture
// gets better. Works on the ink separately from the paper:
//   1. Enlarge, so there's room for smooth edges.
//   2. Find the paper's lighting and remove it (shadows and grey paper become even white).
//   3. Make a clean mask of the ink: grain is gone, and rough pixel edges become smooth curves.
//   4. Redraw: the ink's own colour, through that mask, on the paper (highlighter kept).
//   5. Pictures and solid dark areas aren't ink: those keep their real detail.
import CoreImage

enum ScanFilter {
  /// `mode` "color" keeps pen and highlighter colours; "document" is crisp black on white.
  static func clean(_ input: CIImage, mode: String) -> CIImage {
    var image = input
    let side = max(image.extent.width, image.extent.height)

    // 1. Room for smooth edges: small scans are enlarged to about 3600 on the long side.
    let target: CGFloat = 3600
    if side < target {
      image = image.applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: min(3, target / side), kCIInputAspectRatioKey: 1.0])
    }
    // Everything below is judged the way the eye sees it, not in raw light values.
    image = image.settingAlphaOne(in: image.extent).applyingFilter("CILinearToSRGBToneCurve")
    let ext = image.extent
    let px = max(ext.width, ext.height) / target    // 1 at the working size

    func blur(_ i: CIImage, _ r: CGFloat) -> CIImage {
      i.clampedToExtent().applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: r]).cropped(to: ext)
    }
    func curve(_ i: CIImage, _ p: [(CGFloat, CGFloat)]) -> CIImage {
      i.applyingFilter("CIToneCurve", parameters: [
        "inputPoint0": CIVector(x: p[0].0, y: p[0].1), "inputPoint1": CIVector(x: p[1].0, y: p[1].1), "inputPoint2": CIVector(x: p[2].0, y: p[2].1),
        "inputPoint3": CIVector(x: p[3].0, y: p[3].1), "inputPoint4": CIVector(x: p[4].0, y: p[4].1),
      ])
    }

    // Grain off first, or it would be read as ink: each step keeps the edges of pen lines.
    let calm = blur(image.applyingFilter("CINoiseReduction", parameters: ["inputNoiseLevel": 0.04, "inputSharpness": 0.5]).cropped(to: ext), 1.2 * px)

    // 2. The paper's lighting: at 1/16 size writing nearly vanishes; keep the brightest
    //    nearby colour, soften it, and divide the page by it.
    let k: CGFloat = 1 / 16
    let small = calm.transformed(by: CGAffineTransform(scaleX: k, y: k))
    let paper = small.clampedToExtent()
      .applyingFilter("CIMorphologyMaximum", parameters: ["inputRadius": 3])
      .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: 5])
      .applyingFilter("CIColorClamp", parameters: [
        "inputMinComponents": CIVector(x: 0.1, y: 0.1, z: 0.1, w: 1), "inputMaxComponents": CIVector(x: 1, y: 1, z: 1, w: 1),
      ])
      .cropped(to: small.extent).clampedToExtent()
      .transformed(by: CGAffineTransform(scaleX: 1 / k, y: 1 / k)).cropped(to: ext)
    let flat = paper.applyingFilter("CIDivideBlendMode", parameters: [kCIInputBackgroundImageKey: calm]).cropped(to: ext)

    // 3. The ink. Darkest channel, so blue or red pen counts as fully as black. A small blur
    //    followed by a steep curve is what turns jagged edges into smooth ones, and it
    //    closes the little gaps in a broken line. The low end is set to keep faint pencil.
    let grey = flat.applyingFilter("CIMinimumComponent")
    let soft = blur(grey, 1.4 * px)
    let ink = curve(soft, [(0, 1), (0.62, 1), (0.86, 0.92), (0.94, 0.42), (0.98, 0)]).cropped(to: ext)

    // 5. Where nearly everything nearby counts as ink, it's a picture or a filled shape.
    let crowd = blur(ink, 60 * px)
    let picture = curve(crowd, [(0, 0), (0.3, 0), (0.42, 0.2), (0.55, 0.85), (0.65, 1)]).cropped(to: ext)

    var out: CIImage
    if mode == "document" {
      let white = CIImage(color: .white).cropped(to: ext)
      let black = CIImage(color: CIColor(red: 0.05, green: 0.05, blue: 0.06)).cropped(to: ext)
      out = black.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: white, kCIInputMaskImageKey: ink]).cropped(to: ext)
      let photo = curve(flat.applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 0.0]), [(0, 0), (0.25, 0.2), (0.5, 0.5), (0.8, 0.86), (1, 1)])
      out = photo.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: out, kCIInputMaskImageKey: picture]).cropped(to: ext)
    } else {
      // 4. Paper: nearly white becomes pure white; a highlighter's colour stays. Ink is removed
      //    from it first by keeping the brightest nearby colour.
      let bright = flat.clampedToExtent().applyingFilter("CIMorphologyMaximum", parameters: ["inputRadius": 7 * px]).cropped(to: ext)
      let sheet = curve(blur(bright, 7 * px), [(0, 0), (0.4, 0.42), (0.75, 0.84), (0.9, 1), (1, 1)]).cropped(to: ext)
      // The ink's colour, read from inside the strokes (their edges are paler), deepened.
      let pen = blur(flat.clampedToExtent().applyingFilter("CIMorphologyMinimum", parameters: ["inputRadius": 2.5 * px]).cropped(to: ext), 2.5 * px)
      let deep = curve(pen.applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 1.35]), [(0, 0), (0.3, 0.08), (0.6, 0.28), (0.85, 0.52), (1, 0.85)]).cropped(to: ext)
      out = deep.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: sheet, kCIInputMaskImageKey: ink]).cropped(to: ext)
      // Pictures keep their own detail, with the lighting fixed.
      let photo = curve(flat, [(0, 0), (0.25, 0.2), (0.5, 0.5), (0.8, 0.86), (1, 1)]).cropped(to: ext)
      out = photo.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: out, kCIInputMaskImageKey: picture]).cropped(to: ext)
    }
    return out.applyingFilter("CISRGBToneCurveToLinear").cropped(to: ext)
  }
}
