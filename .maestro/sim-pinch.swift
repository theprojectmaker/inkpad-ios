// Real two-finger gestures on the iPad simulator. The Simulator app turns Option-drag into a pinch
// around the middle of the screen, and Option+Shift-drag into a two-finger scroll.
// usage: swift sim-pinch.swift pinch <fromRadius> <toRadius> | pan <dx> <dy>
import CoreGraphics
import Foundation

func window() -> CGRect? {
  let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
  var best: CGRect?
  for w in list where (w[kCGWindowOwnerName as String] as? String) == "Simulator" && (w[kCGWindowLayer as String] as? Int) == 0 {
    guard let b = w[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
    let r = CGRect(x: b["X"] ?? 0, y: b["Y"] ?? 0, width: b["Width"] ?? 0, height: b["Height"] ?? 0)
    if r.width * r.height > (best.map { $0.width * $0.height } ?? 0) { best = r }
  }
  return best
}

guard let win = window() else { print("no simulator window"); exit(1) }
print("window", win)
let src = CGEventSource(stateID: .hidSystemState)
let args = CommandLine.arguments
let mid = CGPoint(x: win.midX, y: win.midY + 14)

func mouse(_ type: CGEventType, _ p: CGPoint, _ flags: CGEventFlags) {
  let e = CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: p, mouseButton: .left)
  e?.flags = flags
  e?.post(tap: .cghidEventTap)
}
func key(_ code: CGKeyCode, down: Bool, _ flags: CGEventFlags) {
  let e = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down)
  e?.flags = flags
  e?.post(tap: .cghidEventTap)
}
func wait(_ s: Double) { Thread.sleep(forTimeInterval: s) }

func drag(from a: CGPoint, to b: CGPoint, flags: CGEventFlags) {
  mouse(.mouseMoved, a, flags)
  wait(0.15)
  mouse(.leftMouseDown, a, flags)
  wait(0.05)
  let steps = 45
  for i in 1...steps {
    let t = CGFloat(i) / CGFloat(steps)
    mouse(.leftMouseDragged, CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t), flags)
    wait(0.016)
  }
  wait(0.08)
  mouse(.leftMouseUp, b, flags)
}

if args.count >= 4, args[1] == "pinch" {
  // Holding the option key on its own first, as a person would.
  key(58, down: true, .maskAlternate)
  wait(0.1)
  let d = CGFloat(Double(args[2]) ?? 100) * 0.7, e = CGFloat(Double(args[3]) ?? 200) * 0.7
  drag(from: CGPoint(x: mid.x + d, y: mid.y + d), to: CGPoint(x: mid.x + e, y: mid.y + e), flags: .maskAlternate)
  wait(0.1)
  key(58, down: false, [])
} else if args.count >= 4, args[1] == "pan" {
  let flags: CGEventFlags = [.maskAlternate, .maskShift]
  key(58, down: true, .maskAlternate)
  key(56, down: true, flags)
  wait(0.1)
  // The two touches start apart: place them with Option first.
  let dx = CGFloat(Double(args[2]) ?? 0), dy = CGFloat(Double(args[3]) ?? 0)
  let a = CGPoint(x: mid.x + 80, y: mid.y + 80)
  drag(from: a, to: CGPoint(x: a.x + dx, y: a.y + dy), flags: flags)
  wait(0.1)
  key(56, down: false, .maskAlternate)
  key(58, down: false, [])
}
