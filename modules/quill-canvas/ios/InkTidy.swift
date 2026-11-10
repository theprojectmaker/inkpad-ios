// Tidy handwriting, kept as ink: lines are straightened onto a level baseline, words are evened to
// one height and spaced evenly, wobble is smoothed out and the pen weight is made steady. Nothing
// is read or retyped, so it works on any writing (and drawing), with no internet. Pure geometry.
import CoreGraphics
import Foundation

enum InkTidy {
  /// A light finishing pass for a stroke that's just been drawn: only wobble smaller than about a
  /// point on screen is smoothed, and corners are left alone, so the line never visibly moves.
  static func smoothFinished(_ pts: [InkPoint], zoom: Float) -> [InkPoint] {
    guard pts.count > 4 else { return pts }
    let limit = 0.8 / max(0.01, zoom)
    var out = pts
    for _ in 0..<2 {
      let src = out
      for i in 1..<(src.count - 1) {
        let a = src[i - 1], b = src[i], c = src[i + 1]
        let ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y
        let lu = hypot(ux, uy), lv = hypot(vx, vy)
        if lu > 0.0001 && lv > 0.0001 && (ux * vx + uy * vy) / (lu * lv) < 0.3 { continue }   // a corner
        let mx = (a.x + 2 * b.x + c.x) / 4, my = (a.y + 2 * b.y + c.y) / 4
        let d = hypot(mx - b.x, my - b.y)
        let k: Float = d <= limit ? 1 : limit / d
        out[i].x = b.x + (mx - b.x) * k
        out[i].y = b.y + (my - b.y) * k
        out[i].r = (a.r + 2 * b.r + c.r) / 4
      }
    }
    return out
  }

  private struct Item {
    var strokes: [InkStroke]
    var box: CGRect
  }

  /// The selected writing, tidied. Returns new strokes (same colours, kinds and order) in place of `strokes`.
  static func tidy(_ strokes: [InkStroke], nextSeq: () -> UInt32) -> [InkStroke] {
    let writing = strokes.filter { $0.kind != .fill && $0.pts.count > 0 && !$0.bounds.isNull }
    guard !writing.isEmpty else { return strokes }
    // How tall the writing is: the middle stroke height, ignoring dots and long underlines.
    let heights = writing.map { $0.bounds.height }.sorted()
    let unit = max(6, heights[heights.count / 2])

    // 1. Lines: strokes whose middles sit at about the same height.
    var lines: [Item] = []
    for s in writing.sorted(by: { $0.bounds.midY < $1.bounds.midY }) {
      if let i = lines.indices.last(where: { abs(lines[$0].box.midY - s.bounds.midY) < unit * 0.7 }) {
        lines[i].strokes.append(s)
        lines[i].box = lines[i].box.union(s.bounds)
      } else {
        lines.append(Item(strokes: [s], box: s.bounds))
      }
    }

    var result: [InkStroke] = []
    for line in lines {
      // 2. Words: runs of strokes with only small gaps between them.
      var words: [Item] = []
      for s in line.strokes.sorted(by: { $0.bounds.minX < $1.bounds.minX }) {
        if var w = words.last, s.bounds.minX - w.box.maxX < unit * 0.45 {
          w.strokes.append(s)
          w.box = w.box.union(s.bounds)
          words[words.count - 1] = w
        } else {
          words.append(Item(strokes: [s], box: s.bounds))
        }
      }

      // 3. The baseline's slope, from the bottoms of the words (least squares), turned level.
      var angle: CGFloat = 0
      if words.count >= 2 {
        let xs = words.map { $0.box.midX }, ys = words.map { $0.box.maxY }
        let mx = xs.reduce(0, +) / CGFloat(xs.count), my = ys.reduce(0, +) / CGFloat(ys.count)
        var num: CGFloat = 0, den: CGFloat = 0
        for i in xs.indices { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) * (xs[i] - mx) }
        if den > 1 { angle = max(-0.26, min(0.26, atan(num / den))) }   // at most 15 degrees
      }
      let pivot = CGPoint(x: line.box.minX, y: line.box.midY)
      let level = CGAffineTransform(translationX: pivot.x, y: pivot.y).rotated(by: -angle).translatedBy(x: -pivot.x, y: -pivot.y)
      words = words.map { w in
        let ss = angle == 0 ? w.strokes : w.strokes.map { $0.moved(level) }
        return Item(strokes: ss, box: ss.reduce(CGRect.null) { $0.union($1.bounds) })
      }

      // 4. One height and one baseline for the line; even gaps between words.
      let wordHeights = words.map { $0.box.height }.sorted()
      let target = wordHeights[wordHeights.count / 2]
      let bottoms = words.map { $0.box.maxY }.sorted()
      let baseline = bottoms[bottoms.count / 2]
      var gaps: [CGFloat] = []
      for i in 1..<max(1, words.count) { gaps.append(words[i].box.minX - words[i - 1].box.maxX) }
      let gap = gaps.isEmpty ? unit * 0.6 : max(unit * 0.45, min(unit * 1.2, gaps.sorted()[gaps.count / 2]))
      var x = words.first?.box.minX ?? 0
      for w in words {
        // Tall or short words move most of the way to the line's height; small marks stay small.
        let k = w.box.height < target * 0.4 ? 1 : max(0.8, min(1.25, 1 + (target / max(1, w.box.height) - 1) * 0.7))
        let anchor = CGPoint(x: w.box.minX, y: w.box.maxY)
        let dropY = w.box.height < target * 0.4 ? 0 : (baseline - w.box.maxY) * 0.8
        let t = CGAffineTransform(translationX: x, y: anchor.y + dropY)
          .scaledBy(x: k, y: k)
          .translatedBy(x: -anchor.x, y: -anchor.y)
        for s in w.strokes { result.append(steady(s.moved(t))) }
        x += w.box.width * k + gap
      }
    }

    // Same paint order as before, fills kept as they were.
    let fills = strokes.filter { $0.kind == .fill }
    return (fills + result).sorted { $0.seq < $1.seq }.map { s in
      InkStroke(pts: s.pts, rgb: s.rgb, kind: s.kind, seq: s.seq == 0 ? nextSeq() : s.seq, ts: s.ts)
    }
  }

  /// Smooths a stroke's path and makes its weight steadier (most of the way to its own average).
  private static func steady(_ s: InkStroke) -> InkStroke {
    guard s.pts.count > 2 else { return s }
    var pts = s.pts
    for _ in 0..<2 {
      let src = pts
      for i in 1..<(src.count - 1) {
        let a = src[i - 1], b = src[i], c = src[i + 1]
        let ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y
        let lu = hypot(ux, uy), lv = hypot(vx, vy)
        if lu > 0.0001 && lv > 0.0001 && (ux * vx + uy * vy) / (lu * lv) < 0.2 { continue }
        pts[i].x = (a.x + 2 * b.x + c.x) / 4
        pts[i].y = (a.y + 2 * b.y + c.y) / 4
      }
    }
    if s.kind != .marker {
      let avg = pts.reduce(Float(0)) { $0 + $1.r } / Float(pts.count)
      for i in pts.indices { pts[i].r += (avg - pts[i].r) * 0.6 }
    }
    return InkStroke(pts: pts, rgb: s.rgb, kind: s.kind, seq: s.seq, ts: s.ts)
  }
}
