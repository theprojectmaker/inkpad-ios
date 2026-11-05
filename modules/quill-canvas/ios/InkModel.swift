// Quill's own ink: what a stroke is, how the pens behave, and the note's ink file.
// A stroke keeps its final shape (position, radius, opacity per point), so it
// looks the same forever and never depends on the pen settings that made it.
import PencilKit
import UIKit

struct InkPoint {
  var x: Float
  var y: Float
  var r: Float   // radius, in canvas points
  var a: Float   // opacity, 0...1
}

enum InkKind: UInt32 {
  case pen = 0, marker = 1, pencil = 2, dash = 3, dot = 4, fill = 5, spray = 6
}

final class InkStroke {
  let pts: [InkPoint]
  let rgb: UInt32        // r | g << 8 | b << 16
  let kind: InkKind
  let seq: UInt32        // paint order; later strokes sit on top
  let bounds: CGRect
  let ts: Double         // when it was written (seconds since 1970; 0 = unknown)
  var mesh: InkMeshRef?  // on the GPU once it has been on screen
  var lifted = false     // picked up by the lasso

  init(pts: [InkPoint], rgb: UInt32, kind: InkKind, seq: UInt32, ts: Double = 0) {
    self.ts = ts
    self.pts = pts
    self.rgb = rgb
    self.kind = kind
    self.seq = seq
    var minX = Float.greatestFiniteMagnitude, minY = minX, maxX = -minX, maxY = -minX
    for p in pts {
      minX = min(minX, p.x - p.r); maxX = max(maxX, p.x + p.r)
      minY = min(minY, p.y - p.r); maxY = max(maxY, p.y + p.r)
    }
    bounds = pts.isEmpty ? .null : CGRect(x: CGFloat(minX), y: CGFloat(minY), width: CGFloat(maxX - minX), height: CGFloat(maxY - minY))
  }

  func moved(_ t: CGAffineTransform) -> InkStroke {
    let k = Float(sqrt(abs(t.a * t.d - t.b * t.c)))
    let moved = pts.map { p -> InkPoint in
      let q = CGPoint(x: CGFloat(p.x), y: CGFloat(p.y)).applying(t)
      return InkPoint(x: Float(q.x), y: Float(q.y), r: p.r * k, a: p.a)
    }
    return InkStroke(pts: moved, rgb: rgb, kind: kind, seq: seq, ts: ts)
  }

  /// This stroke with the part under a round eraser moving from `a` to `b` removed.
  /// nil: the eraser didn't touch it. Empty: nothing is left.
  func erased(from a: CGPoint, to b: CGPoint, radius: CGFloat) -> [InkStroke]? {
    let rough = CGRect(x: min(a.x, b.x), y: min(a.y, b.y), width: abs(a.x - b.x), height: abs(a.y - b.y)).insetBy(dx: -radius, dy: -radius)
    guard bounds.intersects(rough) else { return nil }
    let dense = InkStroke.resampled(pts, spacing: 1)
    var parts: [[InkPoint]] = [[]]
    var hit = false
    for p in dense {
      let d = InkStroke.distance(CGPoint(x: CGFloat(p.x), y: CGFloat(p.y)), a, b)
      if d < radius + CGFloat(p.r) * 0.5 {
        hit = true
        if !parts[parts.count - 1].isEmpty { parts.append([]) }
      } else {
        parts[parts.count - 1].append(p)
      }
    }
    guard hit else { return nil }
    return parts.filter { $0.count >= 2 }.map { InkStroke(pts: $0, rgb: rgb, kind: kind, seq: seq, ts: ts) }
  }

  static func distance(_ p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> CGFloat {
    let dx = b.x - a.x, dy = b.y - a.y
    let len = dx * dx + dy * dy
    let t = len < 0.0001 ? 0 : max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len))
    return hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
  }

  private static func resampled(_ pts: [InkPoint], spacing: Float) -> [InkPoint] {
    guard pts.count > 1 else { return pts }
    var out: [InkPoint] = [pts[0]]
    out.reserveCapacity(pts.count * 2)
    for (p, q) in zip(pts, pts.dropFirst()) {
      let n = max(1, Int(hypot(q.x - p.x, q.y - p.y) / spacing))
      for i in 1...n {
        let t = Float(i) / Float(n)
        out.append(InkPoint(x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, r: p.r + (q.r - p.r) * t, a: p.a + (q.a - p.a) * t))
      }
    }
    return out
  }
}

/// All the note's strokes, in paint order.
final class InkDocument {
  private(set) var strokes: [InkStroke] = []
  private var lastSeq: UInt32 = 0
  private(set) var version = 0     // goes up whenever the ink changes

  func nextSeq() -> UInt32 { lastSeq += 1; return lastSeq }

  func load(_ s: [InkStroke]) {
    strokes = s
    version += 1
    lastSeq = s.map(\.seq).max() ?? 0
  }

  func apply(removed: [InkStroke], added: [InkStroke]) {
    version += 1
    if removed.count == 1, strokes.last === removed[0] {
      strokes.removeLast()
    } else if !removed.isEmpty {
      let gone = Set(removed.map { ObjectIdentifier($0) })
      strokes.removeAll { gone.contains(ObjectIdentifier($0)) }
    }
    if added.isEmpty { return }
    let inOrder = (strokes.last?.seq ?? 0) <= (added.first?.seq ?? 0) && zip(added, added.dropFirst()).allSatisfy { $0.seq <= $1.seq }
    strokes.append(contentsOf: added)
    if !inOrder { strokes.sort { $0.seq < $1.seq } }
  }

  /// Replaces everything (pages moved or removed), keeping the paint order.
  func replaceAll(_ s: [InkStroke]) { strokes = s; version += 1 }
}

// MARK: - The pens

/// How a pen turns what the Pencil does into a line.
struct InkPen {
  var type = "pen"     // monoline | pen | fountain | pencil | marker
  var rgb: UInt32 = 0x111111
  var width: Float = 2
  var style = ""       // dash | dot: the same pen, broken into dashes or dots
  var angle: Float = 40    // calligraphy: the nib's slant, in degrees
  var stabilize = false    // calligraphy: a much steadier line
  var streamline: Float = 0   // 0...1: how much the hand's wobble is smoothed out

  var kind: InkKind { style == "dash" ? .dash : style == "dot" ? .dot : type == "spray" ? .spray : type == "marker" || type == "watercolor" ? .marker : type == "pencil" || type == "crayon" ? .pencil : .pen }
  /// Pens that start thin and grow into the line.
  var tapers: Bool { type == "pen" || type == "fountain" || type == "brushpen" }

  /// Radius and opacity for one moment of the stroke. `p` is pressure 0...1.
  func shape(p: Float, dirX: Float, dirY: Float, altitude: Float) -> (r: Float, a: Float) {
    let half = width / 2
    switch type {
    case "monoline":
      // An even, round line that barely answers the hand.
      return (half * (0.86 + 0.28 * pow(p, 0.8)), 1)
    case "fountain":
      // A nib held at an angle: thin along it, broad across it.
      let t = angle * .pi / 180
      let across = abs(dirX * -sin(t) + dirY * cos(t))
      return (half * (0.12 + 0.88 * across) * (0.8 + 0.4 * p), 1)
    case "pencil":
      // Tilting the Pencil shades: a wider, lighter line.
      let tilt = max(0, min(1, (1.05 - altitude) / 0.75))
      return (half * (0.7 + 0.5 * p + 2.6 * tilt), max(0.28, min(1, 0.38 + 0.75 * p)) * (1 - 0.4 * tilt))
    case "marker":
      return (half, 0.42)
    case "brushpen":
      // A soft brush tip: almost nothing when light, thick when pressed.
      return (half * (0.08 + 1.9 * pow(p, 1.5)), 1)
    case "feltTip":
      return (half * (0.92 + 0.16 * p), 0.95)
    case "crayon":
      return (half * (1.3 + 0.5 * p), 0.55 + 0.4 * p)
    case "chisel":
      let across = abs(dirX * -sin(Float.pi / 4) + dirY * cos(Float.pi / 4))
      return (half * (0.18 + 0.82 * across), 1)
    case "watercolor":
      return (half * (0.8 + 0.6 * p), 0.28)
    case "spray":
      return (half * 2.2, 0.75)
    default:  // the pressure pen: a hairline when light, bold when pressed
      return (half * (0.16 + 1.5 * pow(p, 1.25)), 1)
    }
  }
}

extension UIColor {
  var inkRGB: UInt32 {
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    getRed(&r, green: &g, blue: &b, alpha: &a)
    let byte = { (v: CGFloat) -> UInt32 in UInt32(max(0, min(255, v * 255 + 0.5))) }
    return byte(r) | byte(g) << 8 | byte(b) << 16
  }
}

// MARK: - The ink file

/// "QINK", version, stroke count; then per stroke: colour, kind, point count, when it was written (version 2), points.
enum InkFile {
  private static let magic: UInt32 = 0x4B4E_4951   // "QINK" read as little-endian

  static func encode(_ strokes: [InkStroke]) -> Data {
    var size = 12
    for s in strokes { size += 20 + s.pts.count * MemoryLayout<InkPoint>.stride }
    var d = Data(capacity: size)
    func put(_ v: UInt32) { withUnsafeBytes(of: v) { d.append(contentsOf: $0) } }
    put(magic); put(2); put(UInt32(strokes.count))
    for s in strokes {
      put(s.rgb); put(s.kind.rawValue); put(UInt32(s.pts.count))
      withUnsafeBytes(of: s.ts) { d.append(contentsOf: $0) }
      s.pts.withUnsafeBytes { d.append(contentsOf: $0) }
    }
    return d
  }

  static func decode(_ d: Data) -> [InkStroke]? {
    d.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> [InkStroke]? in
      guard raw.count >= 12, raw.loadUnaligned(as: UInt32.self) == magic else { return nil }
      let version = raw.loadUnaligned(fromByteOffset: 4, as: UInt32.self)
      let head = version >= 2 ? 20 : 12
      let count = Int(raw.loadUnaligned(fromByteOffset: 8, as: UInt32.self))
      var at = 12
      var out: [InkStroke] = []
      out.reserveCapacity(count)
      let stride = MemoryLayout<InkPoint>.stride
      for i in 0..<count {
        guard at + head <= raw.count else { return nil }
        let rgb = raw.loadUnaligned(fromByteOffset: at, as: UInt32.self)
        let kind = InkKind(rawValue: raw.loadUnaligned(fromByteOffset: at + 4, as: UInt32.self)) ?? .pen
        let n = Int(raw.loadUnaligned(fromByteOffset: at + 8, as: UInt32.self))
        let ts = version >= 2 ? raw.loadUnaligned(fromByteOffset: at + 12, as: Double.self) : 0
        at += head
        guard at + n * stride <= raw.count else { return nil }
        let start = at
        let pts = [InkPoint](unsafeUninitializedCapacity: n) { buf, made in
          UnsafeMutableRawBufferPointer(buf).copyMemory(from: UnsafeRawBufferPointer(rebasing: raw[start..<(start + n * stride)]))
          made = n
        }
        at += n * stride
        out.append(InkStroke(pts: pts, rgb: rgb, kind: kind, seq: UInt32(i + 1), ts: ts))
      }
      return out
    }
  }
}

// MARK: - Ink from before this engine

enum InkImport {
  /// Notes written with Apple's PencilKit: same lines, same colours, erased parts stay erased.
  static func strokes(from drawing: PKDrawing) -> [InkStroke] {
    var out: [InkStroke] = []
    var seq: UInt32 = 0
    let light = UITraitCollection(userInterfaceStyle: .light)
    for s in drawing.strokes {
      let t = s.transform
      let scale = Float(sqrt(abs(t.a * t.d - t.b * t.c)))
      let kind: InkKind = s.ink.inkType == .marker ? .marker : s.ink.inkType == .pencil ? .pencil : .pen
      let rgb = s.ink.color.resolvedColor(with: light).inkRGB
      let ranges: [ClosedRange<CGFloat>?] = s.mask == nil ? [nil] : s.maskedPathRanges.map { $0 }
      for range in ranges {
        var pts: [InkPoint] = []
        for p in s.path.interpolatedPoints(in: range, by: .distance(1.5)) {
          let q = p.location.applying(t)
          let a: Float = kind == .marker ? 0.42 : kind == .pencil ? max(0.25, min(1, Float(p.opacity))) : 1
          pts.append(InkPoint(x: Float(q.x), y: Float(q.y), r: max(0.2, Float(p.size.width) / 2 * scale), a: a))
        }
        if pts.isEmpty { continue }
        seq += 1
        out.append(InkStroke(pts: pts, rgb: rgb, kind: kind, seq: seq))
      }
    }
    return out
  }

  /// Notes from the first version of the app.
  static func strokes(from legacy: [LegacyStroke]) -> [InkStroke] {
    var out: [InkStroke] = []
    for (i, s) in legacy.enumerated() {
      let n = s.pts.count / 3
      if n < 1 { continue }
      var pts: [InkPoint] = []
      pts.reserveCapacity(n)
      for j in 0..<n {
        let p = min(1, max(0, s.pts[j * 3 + 2]))
        let w = s.w * (s.hl ? 1 : 0.6 + 0.8 * p)
        pts.append(InkPoint(x: Float(s.pts[j * 3]), y: Float(s.pts[j * 3 + 1]), r: Float(max(0.5, w)) / 2, a: s.hl ? 0.42 : 1))
      }
      out.append(InkStroke(pts: pts, rgb: UIColor(hex: s.color).inkRGB, kind: s.hl ? .marker : .pen, seq: UInt32(i + 1)))
    }
    return out
  }
}
