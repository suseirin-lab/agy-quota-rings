import Foundation

// Native zero-dependency CDP watcher for AGY Quota Rings on macOS.
// Modes:
//   --managed  : Launch/relaunch Antigravity with CDP, inject quota-rings.js, exit when Antigravity quits.
//   --resident : Stay alive in background, auto-inject whenever Antigravity runs (and relaunch once if missing CDP).
//   --remove   : Remove injected DOM/styles from open Antigravity windows and exit.

final class CdpWatcher {
    let args: Set<String>
    let payloadPath: String
    let session: URLSession
    var injectedPages: [String: Date] = [:]
    var seenLivePort = false
    var missCount = 0
    var relaunchedResidentOnce = false

    let removeExpr = """
    (() => {
      if (window.__agQuotaRings && typeof window.__agQuotaRings.destroy === 'function') {
        window.__agQuotaRings.destroy();
        delete window.__agQuotaRings;
      }
      document.querySelectorAll('#ag-qr-style, #ag-qr-gfont, .ag-qr-dock, .ag-qr-popover').forEach((n) => n.remove());
      return 'removed';
    })()
    """

    init(arguments: [String]) {
        self.args = Set(arguments)
        let appSupport = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/agy-quota-rings")
        let defaultPayload = appSupport.appendingPathComponent("quota-rings.js").path
        if let idx = arguments.firstIndex(of: "--payload"), idx + 1 < arguments.count {
            self.payloadPath = arguments[idx + 1]
        } else {
            self.payloadPath = defaultPayload
        }

        // Bypass all system/env HTTP proxies for local 127.0.0.1 CDP calls
        let cfg = URLSessionConfiguration.ephemeral
        cfg.connectionProxyDictionary = [:]
        cfg.timeoutIntervalForRequest = 4
        cfg.timeoutIntervalForResource = 6
        self.session = URLSession(configuration: cfg)
    }

    func log(_ msg: String) {
        let f = ISO8601DateFormatter()
        let line = "[\(f.string(from: Date()))] \(msg)\n"
        if let data = line.data(using: .utf8) {
            FileHandle.standardOutput.write(data)
        }
    }

    func readCdpPort() -> Int? {
        let portFile = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Antigravity/DevToolsActivePort")
        guard let raw = try? String(contentsOf: portFile, encoding: .utf8) else { return nil }
        let firstLine = raw.components(separatedBy: .newlines).first?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if let port = Int(firstLine), port > 0, port < 65536 {
            return port
        }
        return nil
    }

    func runProcess(_ launchPath: String, _ arguments: [String]) -> Int32 {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: launchPath)
        p.arguments = arguments
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

    func isAntigravityRunning() -> Bool {
        return runProcess("/usr/bin/pgrep", ["-f", "/Antigravity.app/Contents/MacOS/Antigravity"]) == 0
    }

    func antigravityAppPath() -> String {
        if let env = ProcessInfo.processInfo.environment["ANTIGRAVITY_PATH"],
           FileManager.default.fileExists(atPath: env) {
            return env
        }
        let userApp = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Applications/Antigravity.app").path
        if FileManager.default.fileExists(atPath: "/Applications/Antigravity.app") {
            return "/Applications/Antigravity.app"
        }
        if FileManager.default.fileExists(atPath: userApp) {
            return userApp
        }
        return "/Applications/Antigravity.app"
    }

    func listTargets(port: Int) -> [[String: Any]]? {
        guard let url = URL(string: "http://127.0.0.1:\(port)/json/list") else { return nil }
        let sem = DispatchSemaphore(value: 0)
        var result: [[String: Any]]? = nil
        let task = session.dataTask(with: url) { data, _, _ in
            defer { sem.signal() }
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
                return
            }
            result = json.filter { item in
                guard let type = item["type"] as? String, type == "page",
                      let ws = item["webSocketDebuggerUrl"] as? String, !ws.isEmpty,
                      let pageUrl = item["url"] as? String else {
                    return false
                }
                return pageUrl.hasPrefix("http://127.0.0.1:") || pageUrl.hasPrefix("https://127.0.0.1:")
            }
        }
        task.resume()
        _ = sem.wait(timeout: .now() + 2.5)
        return result
    }

    func cdpSend(wsUrlStr: String, method: String, params: [String: Any]) -> Bool {
        guard let url = URL(string: wsUrlStr) else { return false }
        let ws = session.webSocketTask(with: url)
        ws.resume()
        let payload: [String: Any] = ["id": 1, "method": method, "params": params]
        guard let jsonData = try? JSONSerialization.data(withJSONObject: payload),
              let jsonText = String(data: jsonData, encoding: .utf8) else {
            ws.cancel(with: .normalClosure, reason: nil)
            return false
        }

        let sem = DispatchSemaphore(value: 0)
        var ok = false
        var done = false
        let lock = NSLock()

        func finish(_ success: Bool) {
            lock.lock()
            if !done {
                done = true
                ok = success
                sem.signal()
            }
            lock.unlock()
        }

        func receiveLoop() {
            ws.receive { res in
                switch res {
                case .success(let msg):
                    var text: String? = nil
                    switch msg {
                    case .string(let s): text = s
                    case .data(let d): text = String(data: d, encoding: .utf8)
                    @unknown default: break
                    }
                    if let text = text,
                       let d = text.data(using: .utf8),
                       let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                       let id = obj["id"] as? Int, id == 1 {
                        finish(obj["error"] == nil)
                        return
                    }
                    receiveLoop()
                case .failure:
                    finish(false)
                }
            }
        }

        receiveLoop()
        ws.send(.string(jsonText)) { err in
            if err != nil {
                finish(false)
            }
        }

        _ = sem.wait(timeout: .now() + 4.0)
        ws.cancel(with: .normalClosure, reason: nil)
        return ok
    }

    func ensureAntigravityWithCdp(launchIfStopped: Bool, relaunchIfNoCdp: Bool) {
        if let port = readCdpPort(), listTargets(port: port) != nil {
            return
        }
        let running = isAntigravityRunning()
        if running && relaunchIfNoCdp {
            log("[*] Gracefully restarting Antigravity with --remote-debugging-port=0 ...")
            _ = runProcess("/usr/bin/osascript", ["-e", "tell application \"Antigravity\" to quit"])
            for _ in 0..<32 {
                if !isAntigravityRunning() { break }
                Thread.sleep(forTimeInterval: 0.25)
            }
        }
        if launchIfStopped || (running && relaunchIfNoCdp) {
            let appPath = antigravityAppPath()
            log("[*] Launching \(appPath) with --remote-debugging-port=0 ...")
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            p.arguments = ["-a", appPath, "--args", "--remote-debugging-port=0"]
            try? p.run()
        }
    }

    func run() {
        let isManaged = args.contains("--managed")
        let isResident = args.contains("--resident") || !isManaged
        let isRemove = args.contains("--remove")

        if isRemove {
            if let port = readCdpPort(), let pages = listTargets(port: port) {
                for p in pages {
                    if let ws = p["webSocketDebuggerUrl"] as? String {
                        _ = cdpSend(wsUrlStr: ws, method: "Runtime.evaluate", params: ["expression": removeExpr])
                    }
                }
                log("[✓] Removed agy-quota-rings from \(pages.count) window(s).")
            }
            return
        }

        if isManaged {
            ensureAntigravityWithCdp(launchIfStopped: true, relaunchIfNoCdp: true)
        }

        log("[*] AGY Quota Rings watcher started (mode=\(isManaged ? "managed" : "resident"))")

        while true {
            autoreleasepool {
                tick(isManaged: isManaged, isResident: isResident)
            }
            Thread.sleep(forTimeInterval: 2.5)
        }
    }

    func tick(isManaged: Bool, isResident: Bool) {
        guard let port = readCdpPort(), let pages = listTargets(port: port) else {
            if isManaged && seenLivePort {
                missCount += 1
                if missCount >= 3 {
                    log("[*] Antigravity closed; exiting managed watcher.")
                    exit(0)
                }
            } else if isResident {
                if isAntigravityRunning() {
                    if !relaunchedResidentOnce {
                        relaunchedResidentOnce = true
                        ensureAntigravityWithCdp(launchIfStopped: false, relaunchIfNoCdp: true)
                    }
                } else {
                    relaunchedResidentOnce = false
                }
            }
            return
        }

        seenLivePort = true
        missCount = 0
        relaunchedResidentOnce = true

        guard let attrs = try? FileManager.default.attributesOfItem(atPath: payloadPath),
              let mtime = attrs[.modificationDate] as? Date,
              let code = try? String(contentsOfFile: payloadPath, encoding: .utf8) else {
            return
        }

        let activeIds = Set(pages.compactMap { $0["id"] as? String })
        injectedPages = injectedPages.filter { activeIds.contains($0.key) }

        for p in pages {
            guard let id = p["id"] as? String,
                  let ws = p["webSocketDebuggerUrl"] as? String else { continue }
            if injectedPages[id] == mtime { continue }
            _ = cdpSend(wsUrlStr: ws, method: "Page.addScriptToEvaluateOnNewDocument", params: ["source": code])
            if cdpSend(wsUrlStr: ws, method: "Runtime.evaluate", params: ["expression": code]) {
                injectedPages[id] = mtime
                let title = (p["title"] as? String) ?? id
                log("[✓] Injected agy-quota-rings into: \(title)")
            }
        }
    }
}

let watcher = CdpWatcher(arguments: CommandLine.arguments)
watcher.run()
