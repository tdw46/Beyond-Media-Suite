import AppKit
import Foundation

private enum FinderMode: String {
    case convert
    case compress
}

private struct VideoProfile {
    let codec: String
    let pixelFormat: String
    let audioCodec: String
    let twoPass: Bool
    let videoArguments: [String]
    let outputArguments: [String]
}

private struct MediaInfo {
    let duration: Double
    let audioStream: String?
    let width: Int
    let height: Int
}

private enum HelperError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case .message(let text) = self { return text }
        return "Unknown media error."
    }
}

@main
final class FinderMediaApp: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let mode: FinderMode
    private let inputs: [URL]
    private var window: NSWindow!
    private let formatPopup = NSPopUpButton()
    private let ratioSlider = NSSlider(value: 25, minValue: 5, maxValue: 95, target: nil, action: nil)
    private let ratioLabel = NSTextField(labelWithString: "")
    private let targetLabel = NSTextField(labelWithString: "")
    private let statusLabel = NSTextField(labelWithString: "Ready")
    private let progress = NSProgressIndicator()
    private let primaryButton = NSButton()
    private let cancelButton = NSButton(title: "Cancel", target: nil, action: nil)
    private var runningProcess: Process?
    private var cancelled = false
    private var outputs: [URL] = []

    private static let formats = ["MP4", "MKV", "AVI", "MOV", "WebM", "FLV", "TS", "WMV"]

    static func main() {
        let application = NSApplication.shared
        let delegate = FinderMediaApp()
        application.delegate = delegate
        application.run()
    }

    override init() {
        let arguments = Array(CommandLine.arguments.dropFirst())
        mode = FinderMode(rawValue: arguments.first ?? "") ?? .convert
        inputs = arguments.dropFirst().map { URL(fileURLWithPath: $0).standardizedFileURL }
            .filter { FileManager.default.fileExists(atPath: $0.path) }
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard !inputs.isEmpty else {
            showFatal("No media files were received from Finder.")
            return
        }
        NSApp.setActivationPolicy(.accessory)
        buildWindow()
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    func windowWillClose(_ notification: Notification) {
        runningProcess?.terminate()
        NSApp.terminate(nil)
    }

    private func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 296),
            styleMask: [.titled, .closable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = mode == .convert ? "Convert with Beyond Media Suite" : "Compress with Beyond Media Suite"
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.level = .floating
        window.delegate = self
        window.center()

        let effect = NSVisualEffectView()
        effect.material = .hudWindow
        effect.blendingMode = .behindWindow
        effect.state = .active
        window.contentView = effect

        let content = NSStackView()
        content.orientation = .vertical
        content.alignment = .leading
        content.distribution = .fill
        content.spacing = 13
        content.translatesAutoresizingMaskIntoConstraints = false
        effect.addSubview(content)
        let first = inputs[0]
        let icon = NSImageView(image: NSImage(systemSymbolName: "video.fill", accessibilityDescription: "Video") ?? NSImage())
        icon.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 21, weight: .medium)
        icon.contentTintColor = .secondaryLabelColor
        icon.widthAnchor.constraint(equalToConstant: 38).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 38).isActive = true
        let fileName = NSTextField(labelWithString: first.lastPathComponent)
        fileName.font = .systemFont(ofSize: 13.5, weight: .medium)
        fileName.lineBreakMode = .byTruncatingMiddle
        let detailsText = inputs.count == 1
            ? "\(formatBytes(fileSize(first)))  •  \(first.pathExtension.uppercased())"
            : "\(inputSummary())  •  \(first.pathExtension.uppercased()) + \(inputs.count - 1) more"
        let fileDetails = NSTextField(labelWithString: detailsText)
        fileDetails.font = .systemFont(ofSize: 11.5)
        fileDetails.textColor = .secondaryLabelColor
        let fileText = NSStackView(views: [fileName, fileDetails])
        fileText.orientation = .vertical
        fileText.alignment = .leading
        fileText.spacing = 2
        let fileRow = NSStackView(views: [icon, fileText])
        fileRow.orientation = .horizontal
        fileRow.alignment = .centerY
        fileRow.spacing = 10
        fileRow.edgeInsets = NSEdgeInsets(top: 10, left: 13, bottom: 10, right: 13)
        fileRow.wantsLayer = true
        fileRow.layer?.cornerRadius = 12
        fileRow.layer?.backgroundColor = NSColor.controlBackgroundColor.withAlphaComponent(0.58).cgColor
        content.addArrangedSubview(fileRow)
        fileRow.widthAnchor.constraint(equalTo: content.widthAnchor).isActive = true
        fileRow.heightAnchor.constraint(equalToConstant: 62).isActive = true

        formatPopup.addItems(withTitles: Self.formats)
        formatPopup.selectItem(withTitle: "MP4")
        formatPopup.controlSize = .small
        formatPopup.widthAnchor.constraint(equalToConstant: 110).isActive = true
        let formatLabel = NSTextField(labelWithString: mode == .convert ? "Convert to" : "Format")
        formatLabel.font = .systemFont(ofSize: 12.5, weight: .medium)
        let formatValue: NSView
        if mode == .convert {
            formatValue = formatPopup
        } else {
            let keepOriginal = NSTextField(labelWithString: "Keep original")
            keepOriginal.textColor = .secondaryLabelColor
            keepOriginal.font = .systemFont(ofSize: 12)
            formatValue = keepOriginal
        }
        let formatGroup = NSStackView(views: [formatLabel, formatValue])
        formatGroup.orientation = .horizontal
        formatGroup.alignment = .centerY
        formatGroup.spacing = 8

        ratioSlider.isContinuous = true
        ratioSlider.numberOfTickMarks = 0
        ratioSlider.target = self
        ratioSlider.action = #selector(ratioChanged)
        ratioLabel.font = .monospacedDigitSystemFont(ofSize: 13, weight: .semibold)
        ratioLabel.alignment = .right
        let targetTitle = NSTextField(labelWithString: "Target size")
        targetTitle.font = .systemFont(ofSize: 12.5, weight: .medium)
        let targetGroup = NSStackView(views: [targetTitle, ratioLabel])
        targetGroup.orientation = .horizontal
        targetGroup.alignment = .centerY
        targetGroup.spacing = 8
        let settingsSpacer = NSView()
        let settings = NSStackView(views: [formatGroup, settingsSpacer, targetGroup])
        settings.orientation = .horizontal
        settings.alignment = .centerY
        content.addArrangedSubview(settings)
        settings.widthAnchor.constraint(equalTo: content.widthAnchor).isActive = true

        let ratioGroup = NSStackView(views: [ratioSlider, targetLabel])
        ratioGroup.orientation = .vertical
        ratioGroup.spacing = 5
        targetLabel.textColor = .secondaryLabelColor
        targetLabel.font = .systemFont(ofSize: 11.5)
        targetLabel.alignment = .center
        content.addArrangedSubview(ratioGroup)
        ratioGroup.widthAnchor.constraint(equalTo: content.widthAnchor).isActive = true

        progress.style = .spinning
        progress.controlSize = .small
        progress.isIndeterminate = true
        progress.isHidden = true

        statusLabel.textColor = .secondaryLabelColor
        statusLabel.font = .systemFont(ofSize: 12)
        statusLabel.lineBreakMode = .byTruncatingMiddle

        primaryButton.title = mode == .convert ? "Convert" : "Compress"
        primaryButton.keyEquivalent = "\r"
        primaryButton.bezelStyle = .rounded
        primaryButton.target = self
        primaryButton.action = #selector(startEncoding)
        cancelButton.bezelStyle = .rounded
        cancelButton.target = self
        cancelButton.action = #selector(cancelAction)
        let spacer = NSView()
        let statusGroup = NSStackView(views: [progress, statusLabel])
        statusGroup.orientation = .horizontal
        statusGroup.alignment = .centerY
        statusGroup.spacing = 6
        let buttons = NSStackView(views: [statusGroup, spacer, cancelButton, primaryButton])
        buttons.orientation = .horizontal
        buttons.alignment = .centerY
        buttons.spacing = 8

        let footerRule = NSBox()
        footerRule.boxType = .separator
        footerRule.translatesAutoresizingMaskIntoConstraints = false
        buttons.translatesAutoresizingMaskIntoConstraints = false
        effect.addSubview(footerRule)
        effect.addSubview(buttons)

        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: effect.leadingAnchor, constant: 20),
            content.trailingAnchor.constraint(equalTo: effect.trailingAnchor, constant: -20),
            content.topAnchor.constraint(equalTo: effect.topAnchor, constant: 40),
            content.bottomAnchor.constraint(lessThanOrEqualTo: footerRule.topAnchor, constant: -16),

            footerRule.leadingAnchor.constraint(equalTo: effect.leadingAnchor, constant: 20),
            footerRule.trailingAnchor.constraint(equalTo: effect.trailingAnchor, constant: -20),
            footerRule.bottomAnchor.constraint(equalTo: buttons.topAnchor, constant: -13),

            buttons.leadingAnchor.constraint(equalTo: effect.leadingAnchor, constant: 20),
            buttons.trailingAnchor.constraint(equalTo: effect.trailingAnchor, constant: -20),
            buttons.bottomAnchor.constraint(equalTo: effect.bottomAnchor, constant: -15),
            buttons.heightAnchor.constraint(equalToConstant: 28),
        ])
        ratioChanged()
    }

    @objc private func ratioChanged() {
        let ratio = Int(ratioSlider.doubleValue.rounded())
        ratioLabel.stringValue = "\(ratio)%"
        let source = inputs.reduce(Int64(0)) { $0 + fileSize($1) }
        let target = source * Int64(ratio) / 100
        targetLabel.stringValue = "\(formatBytes(source))  →  ≤ \(formatBytes(target))  •  saves about \(100 - ratio)%"
    }

    @objc private func startEncoding() {
        if !outputs.isEmpty {
            NSWorkspace.shared.activateFileViewerSelecting(outputs)
            return
        }
        cancelled = false
        outputs = []
        primaryButton.isEnabled = false
        ratioSlider.isEnabled = false
        formatPopup.isEnabled = false
        cancelButton.title = "Cancel"
        progress.isHidden = false
        progress.startAnimation(nil)
        statusLabel.stringValue = "Preparing…"
        let ratio = Int(ratioSlider.doubleValue.rounded())
        let selectedFormat = (formatPopup.titleOfSelectedItem ?? "MP4").lowercased()
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.encodeAll(ratio: ratio, selectedFormat: selectedFormat)
        }
    }

    @objc private func cancelAction() {
        if runningProcess != nil {
            cancelled = true
            runningProcess?.terminate()
            statusLabel.stringValue = "Cancelling…"
        } else {
            window.close()
        }
    }

    private func encodeAll(ratio: Int, selectedFormat: String) {
        var completed: [URL] = []
        var failures: [String] = []
        for (index, input) in inputs.enumerated() {
            if cancelled { break }
            let sourceFormat = input.pathExtension.lowercased()
            let format = mode == .compress && Self.formats.map({ $0.lowercased() }).contains(sourceFormat)
                ? sourceFormat : selectedFormat
            DispatchQueue.main.async { [weak self] in
                self?.statusLabel.stringValue = "\(index + 1) of \(self?.inputs.count ?? 0): \(input.lastPathComponent)"
            }
            do {
                let output = try encode(input: input, format: format, ratio: ratio)
                completed.append(output)
            } catch {
                if !cancelled { failures.append("\(input.lastPathComponent): \(error.localizedDescription)") }
            }
        }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.runningProcess = nil
            self.progress.stopAnimation(nil)
            self.progress.isHidden = true
            self.ratioSlider.isEnabled = true
            self.formatPopup.isEnabled = true
            self.primaryButton.isEnabled = true
            self.outputs = completed
            if self.cancelled {
                self.statusLabel.stringValue = "Cancelled."
                self.primaryButton.title = self.mode == .convert ? "Convert" : "Compress"
            } else if failures.isEmpty {
                self.statusLabel.stringValue = "Saved \(completed.count) file\(completed.count == 1 ? "" : "s") beside the source."
                self.primaryButton.title = "Show in Finder"
                self.cancelButton.title = "Done"
            } else {
                self.statusLabel.stringValue = failures.joined(separator: "  •  ")
                self.primaryButton.title = completed.isEmpty ? (self.mode == .convert ? "Try Again" : "Try Again") : "Show in Finder"
                self.cancelButton.title = "Done"
            }
        }
    }

    private func encode(input: URL, format: String, ratio: Int) throws -> URL {
        let profile = try profile(for: format)
        let media = try probe(input)
        let sourceBytes = fileSize(input)
        let targetBytes = max(Int64(10_000), sourceBytes * Int64(ratio) / 100)
        let reserve = max(Int64(4096), targetBytes * 2 / 100)
        let audioKbps = media.audioStream == nil ? 0 : 64
        let audioBytes = Int64((Double(audioKbps * 1000) * media.duration / 8).rounded())
        var bitrate = max(8, Int(Double((targetBytes - reserve - audioBytes) * 8) / media.duration / 1000))
        let output = uniqueOutput(for: input, format: format)
        var best: URL?
        var bestSize: Int64 = 0
        defer { if let best { try? FileManager.default.removeItem(at: best) } }

        for _ in 0..<7 {
            if cancelled { throw HelperError.message("Cancelled") }
            let candidate = temporaryURL(extension: format)
            let passLog = FileManager.default.temporaryDirectory.appendingPathComponent("bms-pass-\(UUID().uuidString)")
            let inputDecoder = input.pathExtension.lowercased() == "webm" ? ["-c:v", "libvpx-vp9"] : []
            var video = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y"] + inputDecoder + ["-i", input.path,
                         "-map", "0:v:0", "-c:v", profile.codec, "-pix_fmt", profile.pixelFormat,
                         "-b:v", "\(bitrate)k"]
            if ["yuv420p", "yuva420p"].contains(profile.pixelFormat) {
                video += ["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"]
            }
            video += profile.videoArguments
            if profile.twoPass {
                try runFFmpeg(video + ["-an", "-pass", "1", "-passlogfile", passLog.path, "-f", "null", "/dev/null"])
            }
            var final = video
            if let stream = media.audioStream {
                final += ["-map", stream, "-c:a", profile.audioCodec, "-b:a", "64k"]
            } else {
                final += ["-an"]
            }
            if profile.twoPass { final += ["-pass", "2", "-passlogfile", passLog.path] }
            final += profile.outputArguments + [candidate.path]
            try runFFmpeg(final)
            cleanupPassLog(passLog)
            let size = fileSize(candidate)
            if size <= targetBytes {
                if size > bestSize {
                    if let best { try? FileManager.default.removeItem(at: best) }
                    best = candidate
                    bestSize = size
                } else {
                    try? FileManager.default.removeItem(at: candidate)
                }
                if Double(size) >= Double(targetBytes) * 0.985 { break }
                bitrate = max(bitrate + 1, Int(Double(bitrate) * min(1.5, Double(targetBytes) / Double(max(1, size))) * 0.992))
            } else {
                try? FileManager.default.removeItem(at: candidate)
                bitrate = max(8, Int(Double(bitrate) * Double(targetBytes) / Double(max(1, size)) * 0.97))
            }
        }
        guard let best else {
            throw HelperError.message("Could not reach the requested target size.")
        }
        try FileManager.default.moveItem(at: best, to: output)
        return output
    }

    private func probe(_ input: URL) throws -> MediaInfo {
        let report = try runFFmpeg(["-nostdin", "-hide_banner", "-i", input.path, "-map", "0:v:0", "-frames:v", "1", "-f", "null", "-"])
        guard let durationMatch = match(#"Duration:\s*(\d+):(\d+):([\d.]+)"#, in: report), durationMatch.count == 4 else {
            throw HelperError.message("Could not determine source duration.")
        }
        let hours = Double(durationMatch[1]) ?? 0
        let minutes = Double(durationMatch[2]) ?? 0
        let seconds = Double(durationMatch[3]) ?? 0
        let duration = hours * 3600 + minutes * 60 + seconds
        let dimensions = match(#"Video:.*?(\d{2,5})x(\d{2,5})"#, in: report)
        var audio: String?
        for line in report.components(separatedBy: .newlines) {
            guard let found = match(#"Stream #(\d+:\d+).*Audio:\s*([^,\s]+)"#, in: line), found.count == 3 else { continue }
            let codec = found[2].lowercased()
            if codec != "none" && codec != "unknown" { audio = found[1]; break }
        }
        return MediaInfo(duration: max(0.001, duration), audioStream: audio,
                         width: Int(dimensions?[1] ?? "") ?? 0, height: Int(dimensions?[2] ?? "") ?? 0)
    }

    @discardableResult
    private func runFFmpeg(_ arguments: [String]) throws -> String {
        var resources = URL(fileURLWithPath: CommandLine.arguments[0])
            .standardizedFileURL.deletingLastPathComponent()
        while resources.path != "/" && resources.lastPathComponent != "Resources" {
            resources.deleteLastPathComponent()
        }
        let executable = resources.appendingPathComponent("mac-apple/ffmpeg")
        guard FileManager.default.isExecutableFile(atPath: executable.path) else {
            throw HelperError.message("The bundled FFmpeg executable is missing.")
        }
        let process = Process()
        let pipe = Pipe()
        process.executableURL = executable
        process.arguments = arguments
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = Pipe()
        process.standardError = pipe
        DispatchQueue.main.sync { self.runningProcess = process }
        do { try process.run() } catch { throw HelperError.message(error.localizedDescription) }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        DispatchQueue.main.async { [weak self] in if self?.runningProcess === process { self?.runningProcess = nil } }
        let report = String(data: data, encoding: .utf8) ?? ""
        if cancelled { throw HelperError.message("Cancelled") }
        guard process.terminationStatus == 0 else {
            let useful = report.components(separatedBy: .newlines).filter { !$0.isEmpty }.suffix(4).joined(separator: " ")
            throw HelperError.message(useful.isEmpty ? "FFmpeg failed." : useful)
        }
        return report
    }

    private func profile(for format: String) throws -> VideoProfile {
        switch format {
        case "mp4", "mov":
            return VideoProfile(codec: "libx264", pixelFormat: "yuv420p", audioCodec: "aac", twoPass: true,
                                videoArguments: ["-preset", "slow", "-fps_mode", "vfr"], outputArguments: ["-movflags", "+faststart"])
        case "mkv":
            return VideoProfile(codec: "libx264", pixelFormat: "yuv420p", audioCodec: "aac", twoPass: true,
                                videoArguments: ["-preset", "slow", "-fps_mode", "vfr"], outputArguments: [])
        case "webm":
            return VideoProfile(codec: "libvpx-vp9", pixelFormat: "yuva420p", audioCodec: "libopus", twoPass: true,
                                videoArguments: ["-deadline", "good", "-row-mt", "1", "-threads", "12", "-tile-columns", "2", "-frame-parallel", "1", "-auto-alt-ref", "0", "-fps_mode", "cfr"],
                                outputArguments: ["-metadata:s:v:0", "alpha_mode=1", "-cluster_time_limit", "1000"])
        case "flv", "ts":
            return VideoProfile(codec: "libx264", pixelFormat: "yuv420p", audioCodec: "aac", twoPass: true,
                                videoArguments: ["-preset", "slow", "-fps_mode", "vfr"], outputArguments: [])
        case "avi":
            return VideoProfile(codec: "mpeg4", pixelFormat: "yuv420p", audioCodec: "libmp3lame", twoPass: false,
                                videoArguments: [], outputArguments: [])
        case "wmv":
            return VideoProfile(codec: "wmv2", pixelFormat: "yuv420p", audioCodec: "wmav2", twoPass: false,
                                videoArguments: [], outputArguments: [])
        default: throw HelperError.message("Unsupported output format: \(format.uppercased())")
        }
    }

    private func uniqueOutput(for input: URL, format: String) -> URL {
        let folder = input.deletingLastPathComponent()
        let stem = input.deletingPathExtension().lastPathComponent
        var candidate = folder.appendingPathComponent("\(stem)_opt.\(format)")
        var index = 2
        while FileManager.default.fileExists(atPath: candidate.path) {
            candidate = folder.appendingPathComponent("\(stem)_opt_\(index).\(format)")
            index += 1
        }
        return candidate
    }

    private func temporaryURL(extension ext: String) -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("bms-finder-\(UUID().uuidString).\(ext)")
    }

    private func cleanupPassLog(_ prefix: URL) {
        let folder = prefix.deletingLastPathComponent()
        let name = prefix.lastPathComponent
        for file in (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? [] where file.lastPathComponent.hasPrefix(name) {
            try? FileManager.default.removeItem(at: file)
        }
    }

    private func fileSize(_ url: URL) -> Int64 {
        let values = try? url.resourceValues(forKeys: [.fileSizeKey])
        return Int64(values?.fileSize ?? 0)
    }

    private func inputSummary() -> String {
        "\(inputs.count) selected file\(inputs.count == 1 ? "" : "s") • \(formatBytes(inputs.reduce(Int64(0)) { $0 + fileSize($1) }))"
    }

    private func formatBytes(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.allowedUnits = [.useKB, .useMB, .useGB]
        formatter.countStyle = .file
        return formatter.string(fromByteCount: bytes)
    }

    private func match(_ pattern: String, in text: String) -> [String]? {
        guard let expression = try? NSRegularExpression(pattern: pattern),
              let result = expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        return (0..<result.numberOfRanges).map { index in
            let range = result.range(at: index)
            guard range.location != NSNotFound, let swiftRange = Range(range, in: text) else { return "" }
            return String(text[swiftRange])
        }
    }

    private func showFatal(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Beyond Media Suite"
        alert.informativeText = message
        alert.alertStyle = .critical
        alert.runModal()
        NSApp.terminate(nil)
    }
}
