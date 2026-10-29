#if DEBUG
private actor GET313NoopStore: ReaderStateStore {
    func saveState(_ state: ReaderState, bookID: String) async throws {}
}
@MainActor private enum GET313Probe {
    static var started = false
    static func schedule(_ coordinator: TextReadingView.Coordinator, _ view: UITextView) {
        guard ProcessInfo.processInfo.arguments.contains("--get313-probe"), !started else { return }
        started = true
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(700))
            var report: [String: Any] = [:], cases: [[String: Any]] = []
            var checksum = 0
            func stats(_ values: [Double]) -> [String: Double] {
                let a = values.sorted()
                return ["medianMs": a[a.count / 2], "p95Ms": a[Int(Double(a.count - 1) * 0.95)], "minMs": a.first!, "maxMs": a.last!]
            }
            func time<T>(_ body: () -> T) -> (T, Double) {
                let start = DispatchTime.now().uptimeNanoseconds
                let value = body()
                return (value, Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000)
            }
            for (label, unit) in [("ascii", "reader "), ("bmp", "字e\u{301} "), ("mixed", "a字😀e\u{301} ")] {
                for count in [8, 128_000] {
                    let source = String(repeating: unit, count: count), width = unit.utf16.count
                    let offsets = SourceTextOffsets(source)
                    var oldTimes: [Double] = [], newTimes: [Double] = [], construction: [Double] = []
                    for i in 0..<6 {
                        let input = String(source.dropLast()) + String(i)
                        let built = time { SourceTextOffsets(input) }
                        checksum += built.0.scalarOffset(forUTF16Offset: input.utf16.count / 2)
                        if i >= 2 { construction.append(built.1) }
                        try? await Task.sleep(for: .milliseconds(5))
                    }
                    for i in 0..<26 {
                        let offset = ((i * 7919) % (count - 1) + 1) * width
                        let old: (Int, Double), new: (Int, Double)
                        if i % 2 == 0 {
                            old = time { autoreleasepool { (source as NSString).substring(to: offset).unicodeScalars.count } }
                            new = time { offsets.scalarOffset(forUTF16Offset: offset) }
                        } else {
                            new = time { offsets.scalarOffset(forUTF16Offset: offset) }
                            old = time { autoreleasepool { (source as NSString).substring(to: offset).unicodeScalars.count } }
                        }
                        precondition(old.0 == new.0)
                        checksum += old.0 + new.0
                        if i >= 2 { oldTimes.append(old.1); newTimes.append(new.1) }
                        try? await Task.sleep(for: .milliseconds(5))
                    }
                    cases.append(["case": label, "sourceUTF16Units": offsets.utf16Count, "sourceScalars": offsets.scalarCount, "lookupSamples": oldTimes.count, "constructionSamples": construction.count, "oldLookup": stats(oldTimes), "newLookup": stats(newTimes), "construction": stats(construction)])
                }
            }
            report["componentCases"] = cases; report["checksum"] = checksum
            report["scope"] = "iOS Simulator Debug component comparison, main actor; sleeps outside timed samples; not Release/finger/FPS/RSS/physical latency"
            report["os"] = ProcessInfo.processInfo.operatingSystemVersionString
            let originalParent = coordinator.parent, originalSession = coordinator.parent.session
            _ = await originalSession.flush()
            let span = coordinator.spans.first(where: { $0.passage.id == "text-2" })!
            let location = span.range.location + span.sourceOffsets.utf16Offset(forScalarOffset: 370)
            view.selectedRange = NSRange(location: location, length: 10)
            let selected = (view.text as NSString).substring(with: view.selectedRange)
            var preferences = originalSession.state.preferences
            preferences.fontSize += 2; originalSession.changePreferences(preferences)
            try? await Task.sleep(for: .milliseconds(400))
            let selectionRetained = view.selectedRange.length == 10 && (view.text as NSString).substring(with: view.selectedRange) == selected
            report["selectedText"] = selected; report["selectionRetained"] = selectionRetained
            let target = ReadingAnchor(chapterID: originalSession.chapter.id, passageID: span.passage.id, characterOffset: 500)
            originalSession.go(to: originalSession.chapterIndex, anchor: target)
            try? await Task.sleep(for: .milliseconds(400))
            report["explicitScalar"] = originalSession.currentAnchor?.characterOffset
            let navigationRetained = originalSession.currentAnchor == target && view.selectedRange.length == 0
            report["navigationRetained"] = navigationRetained
            // An isolated in-memory source with identical chapter/passage IDs exercises cache ownership.
            var book = originalSession.book
            book.sourceVersion += "-get313-synthetic"
            let synthetic = String(repeating: "a字😀e\u{301} ", count: 500)
            let chapterIndex = originalSession.chapterIndex
            book.chapters[chapterIndex].passages = [book.chapters[chapterIndex].passages[0]]
            book.chapters[chapterIndex].passages[0].text = synthetic
            var state = ReaderState(); state.preferences = originalSession.state.preferences
            state.anchor = ReadingAnchor(chapterID: originalSession.chapter.id, passageID: book.chapters[chapterIndex].passages[0].id, characterOffset: 0)
            let variant = ReaderSession(book: book, state: state, original: originalSession.original, directory: originalSession.directory, library: GET313NoopStore())
            coordinator.parent = TextReadingView(session: variant, selectionDismissalID: originalParent.selectionDismissalID, onNote: originalParent.onNote, onSource: originalParent.onSource, onExplain: originalParent.onExplain, onWake: originalParent.onWake, onReadingScroll: originalParent.onReadingScroll)
            coordinator.updateContent(view)
            try? await Task.sleep(for: .milliseconds(100))
            let changedSource = view.text == synthetic + "\n\n" && coordinator.spans.count == 1 && coordinator.spans[0].sourceOffsets.scalarCount == 3000 && coordinator.spans[0].sourceOffsets.utf16Count == 3500
            report["sourceSwitchRetainedExactOffsets"] = changedSource
            coordinator.parent = originalParent; coordinator.updateContent(view)
            try? await Task.sleep(for: .milliseconds(300))
            let restored = coordinator.spans.count == originalSession.chapter.passages.count && view.text.contains("waistcoat-")
            report["originalSourceRestored"] = restored
            _ = await originalSession.flush()
            let success = selectionRetained && navigationRetained && changedSource && restored
            report["allPassed"] = success
            let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("get313-probe.json")
            try! JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic)
            view.accessibilityIdentifier = "get313-probe-done"
            view.accessibilityLabel = success ? "all-preserved" : "regression"
        }
    }
}
#endif
