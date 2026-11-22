import AppKit
import Foundation

final class DualRingBadgeView: NSView {
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let bgPath = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 10, yRadius: 10)
        NSColor(calibratedRed: 0.11, green: 0.13, blue: 0.17, alpha: 1.0).setFill()
        bgPath.fill()
        NSColor(calibratedWhite: 1.0, alpha: 0.14).setStroke()
        bgPath.lineWidth = 1.0
        bgPath.stroke()

        drawRing(center: NSPoint(x: bounds.midX, y: bounds.height * 0.65),
                 radius: 7.4, lineWidth: 2.2, progress: 0.82,
                 color: NSColor(calibratedRed: 0.54, green: 0.71, blue: 0.97, alpha: 1.0))

        drawRing(center: NSPoint(x: bounds.midX, y: bounds.height * 0.28),
                 radius: 5.0, lineWidth: 1.9, progress: 0.88,
                 color: NSColor(calibratedRed: 0.51, green: 0.79, blue: 0.58, alpha: 1.0))
    }

    private func drawRing(center: NSPoint, radius: CGFloat, lineWidth: CGFloat, progress: CGFloat, color: NSColor) {
        let track = NSBezierPath()
        track.appendArc(withCenter: center, radius: radius, startAngle: 0, endAngle: 360)
        track.lineWidth = lineWidth
        NSColor(calibratedWhite: 1.0, alpha: 0.14).setStroke()
        track.stroke()

        let arc = NSBezierPath()
        let startDeg: CGFloat = 90
        let endDeg: CGFloat = 90 - 360 * progress
        arc.appendArc(withCenter: center, radius: radius, startAngle: startDeg, endAngle: endDeg, clockwise: true)
        arc.lineWidth = lineWidth
        arc.lineCapStyle = .round
        color.setStroke()
        arc.stroke()
    }
}

final class ModeCardView: NSView {
    var titleText: String
    var subtitleText: String
    var badgeText: String?
    var isSelected: Bool = false { didSet { needsDisplay = true } }
    var onClick: (() -> Void)?

    init(frame: NSRect, title: String, subtitle: String, badge: String? = nil) {
        self.titleText = title
        self.subtitleText = subtitle
        self.badgeText = badge
        super.init(frame: frame)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func mouseDown(with event: NSEvent) {
        onClick?()
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let accent = NSColor.controlAccentColor
        let isDark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua

        let rect = bounds.insetBy(dx: 0.75, dy: 0.75)
        let path = NSBezierPath(roundedRect: rect, xRadius: 11, yRadius: 11)

        let fillColor: NSColor = isSelected
            ? (isDark ? NSColor(calibratedWhite: 1.0, alpha: 0.08) : NSColor(calibratedWhite: 0.0, alpha: 0.04))
            : (isDark ? NSColor(calibratedWhite: 1.0, alpha: 0.03) : NSColor(calibratedWhite: 0.0, alpha: 0.02))
        fillColor.setFill()
        path.fill()

        let borderColor: NSColor = isSelected
            ? accent
            : NSColor.separatorColor.withAlphaComponent(isDark ? 0.55 : 0.4)
        borderColor.setStroke()
        path.lineWidth = isSelected ? 1.5 : 1.0
        path.stroke()

        // Radio dot
        let radioCenter = NSPoint(x: 20, y: bounds.midY)
        let outer = NSBezierPath(ovalIn: NSRect(x: radioCenter.x - 7, y: radioCenter.y - 7, width: 14, height: 14))
        (isSelected ? accent : NSColor.secondaryLabelColor.withAlphaComponent(0.55)).setStroke()
        outer.lineWidth = 1.6
        outer.stroke()

        if isSelected {
            let inner = NSBezierPath(ovalIn: NSRect(x: radioCenter.x - 3.6, y: radioCenter.y - 3.6, width: 7.2, height: 7.2))
            accent.setFill()
            inner.fill()
        }

        // Title
        let titleAttrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 12.5, weight: .semibold),
            .foregroundColor: NSColor.labelColor,
        ]
        let titleNS = titleText as NSString
        let titleSize = titleNS.size(withAttributes: titleAttrs)
        let titleOrigin = NSPoint(x: 38, y: bounds.midY + 1.5)
        titleNS.draw(at: titleOrigin, withAttributes: titleAttrs)

        // Optional badge pill ("推荐")
        if let badge = badgeText {
            let badgeAttrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: 10.5, weight: .medium),
                .foregroundColor: accent,
            ]
            let bNS = badge as NSString
            let bSize = bNS.size(withAttributes: badgeAttrs)
            let pillRect = NSRect(x: titleOrigin.x + titleSize.width + 6,
                                  y: titleOrigin.y + (titleSize.height - (bSize.height + 2)) / 2,
                                  width: bSize.width + 10,
                                  height: bSize.height + 2)
            let pillPath = NSBezierPath(roundedRect: pillRect, xRadius: pillRect.height / 2, yRadius: pillRect.height / 2)
            accent.withAlphaComponent(0.16).setFill()
            pillPath.fill()
            bNS.draw(at: NSPoint(x: pillRect.minX + 5, y: pillRect.minY + 1), withAttributes: badgeAttrs)
        }

        // Subtitle
        let subAttrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 11.5, weight: .regular),
            .foregroundColor: NSColor.secondaryLabelColor,
        ]
        (subtitleText as NSString).draw(at: NSPoint(x: 38, y: bounds.midY - 15.5), withAttributes: subAttrs)
    }
}

final class InstallerController: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var managedCard: ModeCardView!
    var residentCard: ModeCardView!
    var statusLabel: NSTextField!
    var installButton: NSButton!
    var uninstallButton: NSButton!

    var selectedMode: String = "managed" // "managed" or "resident"
    var isInstalled: Bool = false
    var isBusy: Bool = false

    let version = "1.1.0"
    let launchAgentLabel = "com.suseirin.agy-quota-rings"

    var appSupportDir: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/agy-quota-rings")
    }
    var launchAgentPlist: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents/\(launchAgentLabel).plist")
    }
    var launcherAppURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Applications/Antigravity (Quota Rings).app")
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        detectCurrentState()
        buildUI()
        refreshUI()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func detectCurrentState() {
        let fm = FileManager.default
        let hasPlist = fm.fileExists(atPath: launchAgentPlist.path)
        let hasLauncher = fm.fileExists(atPath: launcherAppURL.path)
        let hasWatcher = fm.fileExists(atPath: appSupportDir.appendingPathComponent("agy-quota-rings-watcher").path)
        isInstalled = hasWatcher && (hasPlist || hasLauncher)
        if hasPlist {
            selectedMode = "resident"
        } else {
            selectedMode = "managed"
        }
    }

    func buildUI() {
        let w: CGFloat = 368
        let h: CGFloat = 292
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: w, height: h),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "AGY Quota Rings"
        window.center()
        window.isReleasedWhenClosed = false

        let root = NSView(frame: NSRect(x: 0, y: 0, width: w, height: h))
        window.contentView = root

        // Header badge + title
        let badge = DualRingBadgeView(frame: NSRect(x: 20, y: h - 58, width: 38, height: 38))
        root.addSubview(badge)

        let titleLbl = NSTextField(labelWithString: "AGY Quota Rings")
        titleLbl.font = NSFont.systemFont(ofSize: 15, weight: .semibold)
        titleLbl.frame = NSRect(x: 68, y: h - 38, width: 155, height: 20)
        root.addSubview(titleLbl)

        let verLbl = NSTextField(labelWithString: "v\(version)")
        verLbl.font = NSFont.systemFont(ofSize: 11.5, weight: .regular)
        verLbl.textColor = .secondaryLabelColor
        verLbl.frame = NSRect(x: 196, y: h - 37, width: 60, height: 18)
        root.addSubview(verLbl)

        let subLbl = NSTextField(labelWithString: "Antigravity 左侧双环额度插件")
        subLbl.font = NSFont.systemFont(ofSize: 12, weight: .regular)
        subLbl.textColor = .secondaryLabelColor
        subLbl.frame = NSRect(x: 68, y: h - 56, width: 260, height: 17)
        root.addSubview(subLbl)

        // Mode cards
        managedCard = ModeCardView(
            frame: NSRect(x: 20, y: h - 134, width: w - 40, height: 58),
            title: "随 Antigravity 启动",
            subtitle: "关掉主程序即退出，不常驻后台",
            badge: "推荐"
        )
        managedCard.onClick = { [weak self] in
            guard let self = self, !self.isBusy else { return }
            self.selectedMode = "managed"
            self.refreshUI()
        }
        root.addSubview(managedCard)

        residentCard = ModeCardView(
            frame: NSRect(x: 20, y: h - 202, width: w - 40, height: 58),
            title: "后台常驻监听",
            subtitle: "开机自启，直接开原版即生效"
        )
        residentCard.onClick = { [weak self] in
            guard let self = self, !self.isBusy else { return }
            self.selectedMode = "resident"
            self.refreshUI()
        }
        root.addSubview(residentCard)

        // Status line
        statusLabel = NSTextField(labelWithString: "")
        statusLabel.font = NSFont.systemFont(ofSize: 11.5, weight: .medium)
        statusLabel.textColor = .systemGreen
        statusLabel.frame = NSRect(x: 22, y: 58, width: w - 44, height: 18)
        root.addSubview(statusLabel)

        // Primary Install / Update button
        installButton = NSButton(title: "一键安装", target: self, action: #selector(handleInstall))
        installButton.bezelStyle = .rounded
        installButton.keyEquivalent = "\r"
        installButton.frame = NSRect(x: 20, y: 18, width: w - 40, height: 32)
        root.addSubview(installButton)

        // Uninstall button
        uninstallButton = NSButton(title: "卸载", target: self, action: #selector(handleUninstall))
        uninstallButton.bezelStyle = .rounded
        uninstallButton.frame = NSRect(x: w - 92, y: 18, width: 72, height: 32)
        root.addSubview(uninstallButton)

        window.makeKeyAndOrderFront(nil)
    }

    func refreshUI() {
        managedCard.isSelected = (selectedMode == "managed")
        residentCard.isSelected = (selectedMode == "resident")
        installButton.isEnabled = !isBusy
        uninstallButton.isEnabled = !isBusy

        let w = window.frame.width
        if isInstalled {
            installButton.title = isBusy ? "正在处理..." : "切换 / 更新"
            installButton.frame = NSRect(x: 20, y: 18, width: w - 120, height: 32)
            uninstallButton.isHidden = false
        } else {
            installButton.title = isBusy ? "正在安装..." : "一键安装"
            installButton.frame = NSRect(x: 20, y: 18, width: w - 40, height: 32)
            uninstallButton.isHidden = true
        }
    }

    @discardableResult
    func runCmd(_ path: String, _ args: [String]) -> Int32 {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        do {
            try p.run()
            p.waitUntilExit()
            return p.terminationStatus
        } catch {
            return -1
        }
    }

    func stopExistingWatcher() {
        let uid = String(getuid())
        _ = runCmd("/bin/launchctl", ["bootout", "gui/\(uid)/\(launchAgentLabel)"])
        _ = runCmd("/bin/launchctl", ["unload", launchAgentPlist.path])
        _ = runCmd("/usr/bin/pkill", ["-f", "agy-quota-rings-watcher"])
    }

    @objc func handleInstall() {
        guard !isBusy else { return }
        isBusy = true
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.stringValue = "正在安装配置..."
        refreshUI()

        let mode = selectedMode
        DispatchQueue.global(qos: .userInitiated).async {
            let result = self.performInstall(mode: mode)
            DispatchQueue.main.async {
                self.isBusy = false
                if result.ok {
                    self.isInstalled = true
                    self.statusLabel.textColor = .systemGreen
                    self.statusLabel.stringValue = "✓ \(result.message)"
                } else {
                    self.statusLabel.textColor = .systemRed
                    self.statusLabel.stringValue = "✕ \(result.message)"
                }
                self.refreshUI()
            }
        }
    }

    @objc func handleUninstall() {
        guard !isBusy else { return }
        isBusy = true
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.stringValue = "正在卸载..."
        refreshUI()

        DispatchQueue.global(qos: .userInitiated).async {
            self.performUninstall()
            DispatchQueue.main.async {
                self.isBusy = false
                self.isInstalled = false
                self.statusLabel.textColor = .secondaryLabelColor
                self.statusLabel.stringValue = "✓ 已干净卸载"
                self.refreshUI()
            }
        }
    }

    func performInstall(mode: String) -> (ok: Bool, message: String) {
        let fm = FileManager.default
        guard let resDir = Bundle.main.resourceURL else {
            return (false, "找不到内置插件资源")
        }
        let srcJs = resDir.appendingPathComponent("quota-rings.js")
        let srcWatcher = resDir.appendingPathComponent("agy-quota-rings-watcher")
        let srcIcon = resDir.appendingPathComponent("AppIcon.icns")

        guard fm.fileExists(atPath: srcJs.path), fm.fileExists(atPath: srcWatcher.path) else {
            return (false, "安装包不完整，请重新下载")
        }

        do {
            stopExistingWatcher()
            try fm.createDirectory(at: appSupportDir, withIntermediateDirectories: true)

            let dstJs = appSupportDir.appendingPathComponent("quota-rings.js")
            let dstWatcher = appSupportDir.appendingPathComponent("agy-quota-rings-watcher")
            if fm.fileExists(atPath: dstJs.path) { try fm.removeItem(at: dstJs) }
            if fm.fileExists(atPath: dstWatcher.path) { try fm.removeItem(at: dstWatcher) }
            try fm.copyItem(at: srcJs, to: dstJs)
            try fm.copyItem(at: srcWatcher, to: dstWatcher)
            try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: dstWatcher.path)

            if mode == "managed" {
                if fm.fileExists(atPath: launchAgentPlist.path) {
                    try? fm.removeItem(at: launchAgentPlist)
                }
                try createManagedLauncherApp(watcherPath: dstWatcher.path, iconURL: srcIcon)
                // Also start managed watcher once immediately so user sees the rings right away
                let p = Process()
                p.executableURL = dstWatcher
                p.arguments = ["--managed"]
                try? p.run()
                return (true, "已安装，已创建「Antigravity (Quota Rings)」启动器")
            } else {
                if fm.fileExists(atPath: launcherAppURL.path) {
                    try? fm.removeItem(at: launcherAppURL)
                }
                try createLaunchAgent(watcherPath: dstWatcher.path)
                return (true, "已安装，后台常驻监听已启动")
            }
        } catch {
            return (false, "安装失败: \(error.localizedDescription)")
        }
    }

    func createManagedLauncherApp(watcherPath: String, iconURL: URL) throws {
        let fm = FileManager.default
        let appsDir = launcherAppURL.deletingLastPathComponent()
        try fm.createDirectory(at: appsDir, withIntermediateDirectories: true)
        if fm.fileExists(atPath: launcherAppURL.path) {
            try fm.removeItem(at: launcherAppURL)
        }

        let contentsDir = launcherAppURL.appendingPathComponent("Contents")
        let macosDir = contentsDir.appendingPathComponent("MacOS")
        let resDir = contentsDir.appendingPathComponent("Resources")
        try fm.createDirectory(at: macosDir, withIntermediateDirectories: true)
        try fm.createDirectory(at: resDir, withIntermediateDirectories: true)

        if fm.fileExists(atPath: iconURL.path) {
            try fm.copyItem(at: iconURL, to: resDir.appendingPathComponent("AppIcon.icns"))
        }

        let infoPlist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
          <key>CFBundleExecutable</key>
          <string>launch-antigravity</string>
          <key>CFBundleIdentifier</key>
          <string>com.suseirin.agy-quota-rings.launcher</string>
          <key>CFBundleName</key>
          <string>Antigravity (Quota Rings)</string>
          <key>CFBundleDisplayName</key>
          <string>Antigravity (Quota Rings)</string>
          <key>CFBundlePackageType</key>
          <string>APPL</string>
          <key>CFBundleShortVersionString</key>
          <string>\(version)</string>
          <key>CFBundleIconFile</key>
          <string>AppIcon</string>
          <key>LSUIElement</key>
          <true/>
        </dict>
        </plist>
        """
        try infoPlist.write(to: contentsDir.appendingPathComponent("Info.plist"), atomically: true, encoding: .utf8)

        let script = """
        #!/bin/bash
        LOG="$HOME/Library/Application Support/agy-quota-rings/watch.log"
        mkdir -p "$(dirname "$LOG")"
        pkill -f "agy-quota-rings-watcher" >/dev/null 2>&1 || true
        nohup "\(watcherPath)" --managed >> "$LOG" 2>&1 </dev/null &
        exit 0
        """
        let scriptURL = macosDir.appendingPathComponent("launch-antigravity")
        try script.write(to: scriptURL, atomically: true, encoding: .utf8)
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: scriptURL.path)
    }

    func createLaunchAgent(watcherPath: String) throws {
        let fm = FileManager.default
        let agentsDir = launchAgentPlist.deletingLastPathComponent()
        try fm.createDirectory(at: agentsDir, withIntermediateDirectories: true)
        let logPath = appSupportDir.appendingPathComponent("watch.log").path

        let plist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
          <key>Label</key>
          <string>\(launchAgentLabel)</string>
          <key>ProgramArguments</key>
          <array>
            <string>\(watcherPath)</string>
            <string>--resident</string>
          </array>
          <key>RunAtLoad</key>
          <true/>
          <key>KeepAlive</key>
          <true/>
          <key>StandardOutPath</key>
          <string>\(logPath)</string>
          <key>StandardErrorPath</key>
          <string>\(logPath)</string>
        </dict>
        </plist>
        """
        try plist.write(to: launchAgentPlist, atomically: true, encoding: .utf8)
        let uid = String(getuid())
        let rc = runCmd("/bin/launchctl", ["bootstrap", "gui/\(uid)", launchAgentPlist.path])
        if rc != 0 {
            _ = runCmd("/bin/launchctl", ["load", "-w", launchAgentPlist.path])
        }
    }

    func performUninstall() {
        let fm = FileManager.default
        let watcher = appSupportDir.appendingPathComponent("agy-quota-rings-watcher")
        if fm.fileExists(atPath: watcher.path) {
            _ = runCmd(watcher.path, ["--remove"])
        }
        stopExistingWatcher()
        try? fm.removeItem(at: launchAgentPlist)
        try? fm.removeItem(at: launcherAppURL)
        try? fm.removeItem(at: appSupportDir)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = InstallerController()
app.delegate = delegate
app.run()
