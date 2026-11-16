// A view whose contents show on the iPad but are left out of anything that captures the screen:
// screen sharing in a call, AirPlay mirroring, a screen recording, a screenshot. Quill puts its
// toolbars in one, so the people watching see only the page.
//
// iOS has no public switch for this. What it does have is the way a password field hides what's
// typed in it from captures: the field draws inside a special layer the system leaves out. This
// borrows that layer and puts the toolbars in it. If a future iPadOS changes how the field is
// built and the layer can't be found, the contents are simply shown as normal.
import ExpoModulesCore
import React
import UIKit

public final class QuillShieldModule: Module {
  public func definition() -> ModuleDefinition {
    Name("QuillShield")

    View(QuillShieldView.self) {
      // Off: the contents are captured like everything else.
      Prop("shielded") { (view: QuillShieldView, on: Bool) in
        view.shielded = on
      }
    }
  }
}

public final class QuillShieldView: ExpoView {
  private let field = UITextField()
  private var holder: UIView?

  var shielded = true {
    didSet { field.isSecureTextEntry = shielded }
  }

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    field.isSecureTextEntry = true
    // The part of a password field that the system keeps out of captures.
    let inside = field.subviews.first { String(describing: type(of: $0)).contains("CanvasView") } ?? field.subviews.first
    if let inside {
      inside.isUserInteractionEnabled = true
      inside.backgroundColor = .clear
      inside.frame = bounds
      inside.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      addSubview(inside)
      holder = inside
    }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    holder?.frame = bounds
  }

  public override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
    if let holder {
      holder.insertSubview(childComponentView, at: min(index, holder.subviews.count))
    } else {
      insertSubview(childComponentView, at: min(index, subviews.count))
    }
  }

  public override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
    childComponentView.removeFromSuperview()
  }

  /// Only the toolbars take touches; everywhere else they go through to the page underneath.
  public override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let hit = super.hitTest(point, with: event)
    return hit === self || hit === holder ? nil : hit
  }
}
